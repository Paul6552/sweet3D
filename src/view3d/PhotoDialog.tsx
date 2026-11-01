import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  CircleGeometry,
  Color,
  CubeCamera,
  DirectionalLight,
  DoubleSide,
  HalfFloatType,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PerspectiveCamera,
  PointLight,
  type Scene,
  Scene as ThreeScene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/worker'
import { compileOnce, slimPathTracerShader } from './pathTracerShader'
import { createSky, GROUND_BOUNCE } from './sky'
import { currentExposure } from './eyeAdaptation'
import { useBrightRoomsStore } from './brightRooms'
import { INDOOR_GLSL, indoorUniforms } from './indoorLight'

/** Szene und Kamera der 3D-Ansicht zum Zeitpunkt des Fotos. */
export interface SceneHandle {
  scene: Scene
  camera: Camera
}

const SIZES = [
  { label: 'HD', width: 1280, height: 720 },
  { label: 'Full HD', width: 1920, height: 1080 },
  { label: '4K', width: 3840, height: 2160 },
] as const
const SAMPLE_OPTIONS = [64, 256, 1024]
/**
 * Angestrebte mittlere GPU-Zeit je Kachel. Treiber setzen die Grafikkarte zurück, wenn ein Befehl
 * sie zu lange blockiert (Intel i915 unter Linux schon nach 640 ms) – dann geht der WebGL-Kontext
 * verloren. Der Abstand fängt Kacheln auf, die aufwendiger sind als der Durchschnitt.
 */
const TILE_BUDGET_MS = 50
/** Zeitbudget je Bild für mehrere Kacheln hintereinander, damit die Seite bedienbar bleibt. */
const FRAME_BUDGET_MS = 30
/** Start- und Mindestgröße einer Kachel in Pixeln, klein genug auch für schwache integrierte Grafik. */
const START_TILE_PIXELS = 64 * 64
/** Anteil der Modellfarbe an der Tönung von Glas; der Rest ist farblos. */
const GLASS_TINT = 0.15
/** Farbe der unsichtbaren Decken und Ebenen darüber, die Licht im Raum zurückwerfen. */
const CEILING = '#fafafa'

/** Kachelraster für die gewünschte Pixelzahl je Kachel, ungefähr quadratische Kacheln. */
function tileGrid(width: number, height: number, tilePixels: number): [number, number] {
  const side = Math.sqrt(Math.max(tilePixels, START_TILE_PIXELS))
  return [Math.max(1, Math.ceil(width / side)), Math.max(1, Math.ceil(height / side))]
}

/**
 * Teilt ein Mesh mit mehreren Materialien in eine Geometrie je Gruppe. three-gpu-pathtracer zählt
 * beim Zusammenführen jedes Mesh als eine Gruppe, die Materialliste enthält aber alle Materialien
 * eines Meshes: Nach dem ersten Mesh mit mehreren Materialien sind alle folgenden Zuordnungen
 * verschoben (falsche Farben).
 */
function groupParts(geometry: BufferGeometry, materials: Material[], cache: Map<BufferGeometry, BufferGeometry[]>): [BufferGeometry, Material][] {
  const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }]
  let parts = cache.get(geometry)
  if (!parts) {
    const index = geometry.index
    const total = index ? index.count : geometry.getAttribute('position').count
    parts = groups.map(({ start, count }) => {
      // Nur die Ecken der Gruppe übernehmen, sonst verdoppelt der Pathtracer alle Attribute je Teil
      const end = Math.min(total, start + count)
      const indices = new Uint32Array(Math.max(0, end - start))
      const used = new Map<number, number>()
      for (let i = 0; i < indices.length; i++) {
        const vertex = index ? index.getX(start + i) : start + i
        let mapped = used.get(vertex)
        if (mapped === undefined) used.set(vertex, (mapped = used.size))
        indices[i] = mapped
      }
      const part = new BufferGeometry()
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        // Gleicher Datentyp, damit normalisierte Attribute (z. B. Farben) ihre Bedeutung behalten
        const values = new (attribute.array.constructor as Float32ArrayConstructor)(used.size * attribute.itemSize)
        used.forEach((to, from) => {
          for (let c = 0; c < attribute.itemSize; c++) values[to * attribute.itemSize + c] = attribute.getComponent(from, c)
        })
        part.setAttribute(name, new BufferAttribute(values, attribute.itemSize, attribute.normalized))
      }
      part.setIndex(new BufferAttribute(indices, 1))
      return part
    })
    cache.set(geometry, parts)
  }
  return groups.flatMap(({ materialIndex }, i): [BufferGeometry, Material][] => {
    const material = materials[materialIndex ?? 0]
    return material && parts[i].index!.count > 0 ? [[parts[i], material]] : []
  })
}

/**
 * Kopie der sichtbaren Szene für den Pathtracer: Meshes mit ihrer Lage in der Welt (Geometrien
 * und Materialien geteilt, Glas als dünne, lichtdurchlässige Scheibe), Sonne und Leuchten. Den Himmel liefert
 * eine Würfelumgebung, die der Pathtracer selbst abtastet.
 */
function photoScene(source: Scene, renderer: WebGLRenderer): { scene: ThreeScene; dispose: () => void } {
  const scene = new ThreeScene()
  const glass = new Map<Material, Material>()
  const toPhoto = (m: Material) => {
    if (!m.userData.glass) return m
    let result = glass.get(m)
    if (!result) {
      const physical = (m as MeshPhysicalMaterial).clone()
      // Der Pathtracer färbt durchgelassenes Licht mit der Materialfarbe; Glas aus Modellen ist meist
      // dunkel und wirkt im Raster nur durch die Deckkraft durchsichtig. Dicke 0: dünne Scheibe ohne Versatz
      physical.color = new Color('#ffffff').lerp(physical.color, GLASS_TINT)
      Object.assign(physical, { transmission: 1, opacity: 1, transparent: false, roughness: 0, metalness: 0, thickness: 0 })
      result = physical
      glass.set(m, result)
    }
    return result
  }
  // Teilgeometrien von Meshes mit mehreren Materialien, je Geometrie einmal
  const split = new Map<BufferGeometry, BufferGeometry[]>()
  const hidden = new MeshStandardMaterial({ color: CEILING, roughness: 0.9, side: DoubleSide })
  // Für die Kamera unsichtbar, hält aber Licht ab (siehe hideMatteFromCamera)
  Object.assign(hidden, { matte: true })
  source.updateMatrixWorld(true)
  // Sonnenstand wie in der 3D-Ansicht: Richtung von der Sonne zum Ziel
  const sunDirection = new Vector3(0, 1, 0)
  source.traverseVisible((object) => {
    if (object.userData.photo === false) return
    if (object instanceof Mesh) {
      // Teile, die in der 3D-Ansicht nur Schatten werfen: Decken in der Luftansicht und Ebenen darüber
      const parts: [BufferGeometry, Material][] =
        object.userData.photo === 'hidden'
          ? [[object.geometry, hidden]]
          : Array.isArray(object.material)
            ? groupParts(object.geometry, object.material, split)
            : [[object.geometry, object.material as Material]]
      for (const [geometry, material] of parts) {
        const copy = new Mesh(geometry, toPhoto(material))
        copy.matrixAutoUpdate = false
        copy.matrix.copy(object.matrixWorld)
        scene.add(copy)
      }
    } else if (object instanceof DirectionalLight) {
      const light = new DirectionalLight(object.color, object.intensity)
      light.position.setFromMatrixPosition(object.matrixWorld)
      light.target.position.setFromMatrixPosition(object.target.matrixWorld)
      scene.add(light, light.target)
      sunDirection.subVectors(light.position, light.target.position).normalize()
    } else if (object instanceof PointLight) {
      const light = new PointLight(object.color, object.intensity, object.distance, object.decay)
      light.position.setFromMatrixPosition(object.matrixWorld)
      scene.add(light)
    }
  })
  // Himmel als Würfelumgebung im Kontext des Foto-Renderers
  const target = new WebGLCubeRenderTarget(512)
  const environment = new ThreeScene()
  const sky = createSky(sunDirection)
  sky.scale.setScalar(50)
  const ground = new Mesh(new CircleGeometry(40, 32), new MeshBasicMaterial({ color: GROUND_BOUNCE }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -1
  environment.add(sky, ground)
  new CubeCamera(0.1, 100, target).update(renderer, environment)
  scene.environment = target.texture
  scene.environmentIntensity = source.environmentIntensity
  scene.background = target.texture
  return {
    scene,
    dispose: () => {
      target.dispose()
      sky.geometry.dispose()
      sky.material.dispose()
      ground.geometry.dispose()
      ground.material.dispose()
      glass.forEach((m) => m.dispose())
      hidden.dispose()
      split.forEach((parts) => parts.forEach((g) => g.dispose()))
    },
  }
}

/**
 * Anpassung je Raum wie in der Luftansicht (siehe indoorLight): je Pixel des Fotos der Faktor, um den
 * das Licht der dort sichtbaren Fläche angehoben wird (Kanal r, 1 im Freien). Für die Kamera
 * unsichtbare Decken zählen nicht.
 */
function adaptationImage(renderer: WebGLRenderer, scene: ThreeScene, camera: Camera, width: number, height: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter })
  const material = new ShaderMaterial({
    uniforms: indoorUniforms,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vWorldNormal;
      void main() {
        vec4 world = modelMatrix * vec4( position, 1.0 );
        vWorld = world.xyz;
        vWorldNormal = mat3( modelMatrix ) * normal;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      ${INDOOR_GLSL}
      varying vec3 vWorld;
      varying vec3 vWorldNormal;
      void main() {
        // Wie in der 3D-Ansicht etwas vor der Fläche nachschlagen
        vec3 n = dot( vWorldNormal, vWorldNormal ) > 0.0 ? normalize( vWorldNormal ) * ( gl_FrontFacing ? 1.0 : - 1.0 ) : vec3( 0.0 );
        vec2 uv;
        float factor = 1.0;
        if ( indoorUv( vWorld + n * 15.0, uv ) ) factor = mix( 1.0, texture2D( indoorRooms, uv ).g, indoorAdapt );
        gl_FragColor = vec4( factor, 0.0, 0.0, 1.0 );
      }`,
  })
  const hidden: Mesh[] = []
  scene.traverse((object) => {
    if (object instanceof Mesh && object.visible && (object.material as { matte?: boolean }).matte) {
      object.visible = false
      hidden.push(object)
    }
  })
  const background = scene.background
  const clearColor = renderer.getClearColor(new Color())
  const clearAlpha = renderer.getClearAlpha()
  scene.background = null
  scene.overrideMaterial = material
  renderer.setRenderTarget(target)
  renderer.setClearColor(0xffffff, 1)
  renderer.clear()
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)
  renderer.setClearColor(clearColor, clearAlpha)
  scene.overrideMaterial = null
  scene.background = background
  hidden.forEach((mesh) => (mesh.visible = true))
  material.dispose()
  return target
}

/** Lässt die Ausgabe des Pathtracers jedes Pixel vor dem Tonemapping mit dem Bild der Anpassung multiplizieren. */
function applyAdaptation(output: ShaderMaterial, adaptation: WebGLRenderTarget) {
  output.uniforms.adaptationMap = { value: adaptation.texture }
  output.fragmentShader = output.fragmentShader
    .replace('uniform float opacity;', 'uniform float opacity;\nuniform sampler2D adaptationMap;')
    .replace('res.xyz = toneMapping( res.xyz );', 'res.xyz = toneMapping( res.xyz * texelFetch( adaptationMap, px, 0 ).r );')
  output.needsUpdate = true
}

/**
 * Fotorealistisches Standbild der aktuellen Ansicht per Pathtracing: Licht wird physikalisch
 * korrekt verfolgt (indirektes Licht, weiche Schatten, Spiegelungen, Glas). Das Bild wird mit
 * jedem Durchgang rauschärmer.
 */
export function PhotoDialog({ open, onClose, handle }: { open: boolean; onClose: () => void; handle: () => SceneHandle | null }) {
  const { t } = useTranslation()
  const [size, setSize] = useState(0)
  const [maxSamples, setMaxSamples] = useState(256)
  const [samples, setSamples] = useState(0)
  const [state, setState] = useState<'idle' | 'preparing' | 'rendering' | 'done' | 'error'>('idle')
  // Wirkt über die Szene der 3D-Ansicht (siehe HomeScene); hier nur der Hinweis darauf
  const brightRooms = useBrightRoomsStore((s) => s.brightRooms)
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const stop = useRef<(() => void) | null>(null)

  const cancel = () => {
    stop.current?.()
    stop.current = null
  }
  useEffect(() => () => cancel(), [])

  const start = () => {
    cancel()
    const current = handle()
    if (!current || !container.current) return
    const { width, height } = SIZES[size]
    const element = document.createElement('canvas')
    element.style.width = '100%'
    element.style.height = 'auto'
    element.style.display = 'block'
    container.current.replaceChildren(element)
    canvas.current = element
    const renderer = new WebGLRenderer({ canvas: element, antialias: false, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(width, height, false)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    // Wie die 3D-Ansicht an Innenräume angepasst (Besucher); in der Luftansicht je Raum, siehe unten
    renderer.toneMappingExposure = currentExposure()
    const source = current.camera as PerspectiveCamera
    const camera = new PerspectiveCamera(source.fov, width / height, source.near, source.far)
    camera.position.setFromMatrixPosition(source.matrixWorld)
    camera.quaternion.setFromRotationMatrix(source.matrixWorld)
    if (camera.position.length() === 0) camera.position.copy(new Vector3(0, 500, 500))
    const { scene, dispose } = photoScene(current.scene, renderer)
    const tracer = new WebGLPathTracer(renderer)
    // Fehlt in den Typen der Bibliothek
    const internals = tracer as unknown as {
      isCompiling: boolean
      _pathTracer: { material: ShaderMaterial & { onBeforeRender: () => void } }
      _quad: { material: ShaderMaterial }
    }
    const adaptation = indoorUniforms.indoorAdapt.value > 0 ? adaptationImage(renderer, scene, camera, width, height) : null
    if (adaptation) applyAdaptation(internals._quad.material, adaptation)
    // Kleinerer Shader, der auch auf schwacher Grafik schnell genug kompiliert
    slimPathTracerShader(internals._pathTracer.material, scene)
    tracer.bounces = 5
    tracer.transmissiveBounces = 4
    // Weniger Glanzpunkt-Rauschen (Fireflies) bei rauen Spiegelungen
    tracer.filterGlossyFactor = 0.5
    tracer.minSamples = 1
    tracer.renderDelay = 0
    tracer.fadeDuration = 0
    // Kleine Kacheln: lange Grafikbefehle setzt der Treiber sonst als hängend zurück (Context Lost).
    // Die Größe passt sich nach jedem Durchgang an die gemessene Rechenzeit an.
    tracer.tiles.set(...tileGrid(width, height, START_TILE_PIXELS))
    // Nur das Pathtracing-Ergebnis zeigen, nicht darunter die normale Darstellung
    tracer.rasterizeScene = false
    // Die Beschleunigungsstruktur in Hintergrund-Threads bauen, damit die Seite bedienbar bleibt
    const worker = new ParallelMeshBVHWorker()
    tracer.setBVHWorker(worker)
    let frame = 0
    let stopped = false
    stop.current = () => {
      stopped = true
      cancelAnimationFrame(frame)
      tracer.dispose()
      worker.dispose()
      adaptation?.dispose()
      dispose()
      renderer.dispose()
    }
    element.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      if (stopped) return
      stop.current?.()
      stop.current = null
      setState('error')
    })
    setSamples(0)
    setState('preparing')
    tracer
      .setSceneAsync(scene, camera)
      .then(() => {
        if (stopped) return
        compileOnce(internals._pathTracer.material)
        setState('rendering')
        // Ein Pixel zurücklesen wartet, bis die Grafikkarte die Kachel fertig hat – so lässt sich
        // ihre Rechenzeit messen
        const pixel = new Float32Array(4)
        let spent = 0 // gemessene Zeit und Pixel im laufenden Durchgang
        let measured = 0
        let warmedUp = false
        let previous = 0
        const loop = () => {
          if (stopped) return
          // Der Shader kompiliert noch: nicht auf die Grafikkarte warten, sonst hängt die Seite
          if (internals.isCompiling) {
            frame = requestAnimationFrame(loop)
            return
          }
          const frameStart = performance.now()
          let done = previous
          do {
            const tilePixels = (width / tracer.tiles.x) * (height / tracer.tiles.y)
            const tileStart = performance.now()
            tracer.renderSample()
            renderer.readRenderTargetPixels(tracer.target, 0, 0, 1, 1, pixel)
            // Die erste Kachel enthält das Hochladen der Szene und zählt nicht
            if (warmedUp) {
              spent += performance.now() - tileStart
              measured += tilePixels
            }
            warmedUp = true
            // samples zählt anteilig je Kachel
            done = Math.floor(tracer.samples)
            if (done > previous && measured > 0) {
              // Durchgang fertig: Kacheln nach der mittleren Zeit je Pixel bemessen, höchstens vervierfachen
              tracer.tiles.set(...tileGrid(width, height, Math.min((TILE_BUDGET_MS * measured) / spent, tilePixels * 4)))
              spent = measured = 0
            }
            previous = done
          } while (done < maxSamples && !stopped && performance.now() - frameStart < FRAME_BUDGET_MS)
          if (stopped) return
          setSamples(done)
          if (done >= maxSamples) {
            setState('done')
            return
          }
          frame = requestAnimationFrame(loop)
        }
        frame = requestAnimationFrame(loop)
      })
      .catch(() => !stopped && setState('error'))
  }

  const download = () => {
    canvas.current?.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'foto.png'
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const close = () => {
    cancel()
    setState('idle')
    onClose()
  }
  const busy = state === 'preparing' || state === 'rendering'

  return (
    <Dialog open={open} onClose={close} maxWidth="lg" fullWidth>
      <DialogTitle>{t('photo.title')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1, flexWrap: 'wrap' }}>
          <TextField select size="small" label={t('photo.size')} value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={busy}>
            {SIZES.map((s, i) => (
              <MenuItem key={s.label} value={i}>
                {`${s.label} (${s.width} × ${s.height})`}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={t('photo.quality')} value={maxSamples} onChange={(e) => setMaxSamples(Number(e.target.value))} disabled={busy}>
            {SAMPLE_OPTIONS.map((n, i) => (
              <MenuItem key={n} value={n}>
                {t(['photo.draft', 'photo.good', 'photo.best'][i])}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        {brightRooms && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('photo.brightRooms')}
          </Alert>
        )}
        {state === 'idle' && (
          <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
            {t('photo.hint')}
          </Typography>
        )}
        {/* Nimmt das Canvas des Pathtracers auf; React rendert hier keine Kinder */}
        <Box ref={container} sx={{ borderRadius: 1, overflow: 'hidden' }} />
        {state !== 'idle' && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress variant={state === 'preparing' ? 'indeterminate' : 'determinate'} value={Math.min(100, (samples / maxSamples) * 100)} />
            <Typography variant="caption" color={state === 'error' ? 'error' : 'text.secondary'}>
              {state === 'preparing'
                ? t('photo.preparing')
                : state === 'error'
                  ? t('photo.error')
                  : t('photo.progress', { samples, total: maxSamples })}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('photo.close')}</Button>
        {busy && <Button onClick={() => (cancel(), setState('done'))}>{t('photo.stop')}</Button>}
        <Button onClick={download} disabled={state !== 'done' && state !== 'rendering'}>
          {t('photo.download')}
        </Button>
        <Button variant="contained" onClick={start} disabled={busy}>
          {t('photo.render')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
