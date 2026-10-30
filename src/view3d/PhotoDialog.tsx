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
  type Camera,
  CircleGeometry,
  CubeCamera,
  DirectionalLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PointLight,
  type Scene,
  Scene as ThreeScene,
  SRGBColorSpace,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
} from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/worker'
import { createSky, GROUND_BOUNCE } from './sky'
import { currentExposure } from './eyeAdaptation'

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
 * Kopie der sichtbaren Szene für den Pathtracer: Meshes mit ihrer Lage in der Welt (Geometrien
 * und Materialien geteilt, Glas mit echter Lichtbrechung), Sonne und Leuchten. Den Himmel liefert
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
      Object.assign(physical, { transmission: 1, opacity: 1, transparent: false, roughness: 0, thickness: 1 })
      result = physical
      glass.set(m, result)
    }
    return result
  }
  source.updateMatrixWorld(true)
  // Sonnenstand wie in der 3D-Ansicht: Richtung von der Sonne zum Ziel
  const sunDirection = new Vector3(0, 1, 0)
  source.traverseVisible((object) => {
    if (object.userData.photo === false) return
    if (object instanceof Mesh) {
      const material = Array.isArray(object.material) ? object.material.map(toPhoto) : toPhoto(object.material as Material)
      const copy = new Mesh(object.geometry, material)
      copy.matrixAutoUpdate = false
      copy.matrix.copy(object.matrixWorld)
      scene.add(copy)
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
    },
  }
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
    // Wie die 3D-Ansicht an Innenräume angepasst
    renderer.toneMappingExposure = 0.9 * currentExposure()
    const source = current.camera as PerspectiveCamera
    const camera = new PerspectiveCamera(source.fov, width / height, source.near, source.far)
    camera.position.setFromMatrixPosition(source.matrixWorld)
    camera.quaternion.setFromRotationMatrix(source.matrixWorld)
    if (camera.position.length() === 0) camera.position.copy(new Vector3(0, 500, 500))
    const { scene, dispose } = photoScene(current.scene, renderer)
    const tracer = new WebGLPathTracer(renderer)
    tracer.bounces = 5
    tracer.transmissiveBounces = 4
    // Weniger Glanzpunkt-Rauschen (Fireflies) bei rauen Spiegelungen
    tracer.filterGlossyFactor = 0.5
    tracer.minSamples = 1
    tracer.renderDelay = 0
    tracer.fadeDuration = 0
    // Kleine Kacheln je Bild: lange Grafikbefehle setzt der Browser sonst als hängend zurück (Context Lost)
    tracer.tiles.set(4, 4)
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
        setState('rendering')
        const loop = () => {
          if (stopped) return
          tracer.renderSample()
          // Eine Kachel je Bild; samples zählt anteilig
          const done = Math.floor(tracer.samples)
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
