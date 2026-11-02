import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  CircleGeometry,
  Color,
  CubeCamera,
  DataTexture,
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
  type PixelFormat,
  PointLight,
  Quaternion,
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
import { INDOOR_GLSL, indoorUniforms } from './indoorLight'

/** Scene, camera and renderer of the 3D view at the moment a photo is requested. */
export interface SceneHandle {
  scene: Scene
  camera: Camera
  gl: WebGLRenderer
}

export const PHOTO_SIZES = [
  { label: 'HD', width: 1280, height: 720 },
  { label: 'Full HD', width: 1920, height: 1080 },
  { label: '4K', width: 3840, height: 2160 },
] as const
export const SAMPLE_OPTIONS = [64, 256, 1024]
/** i18n keys of the quality levels in {@link SAMPLE_OPTIONS}. */
export const QUALITY_KEYS = ['photo.draft', 'photo.good', 'photo.best'] as const
/**
 * Target mean GPU time per tile. Drivers reset the GPU when a command blocks it for too long
 * (Intel i915 on Linux already after 640 ms) and the WebGL context is lost. The margin absorbs
 * tiles that are more expensive than average.
 */
const TILE_BUDGET_MS = 50
/** Time budget per animation frame for several tiles in a row, so the page stays responsive. */
const FRAME_BUDGET_MS = 30
/** Budget per step while the tab is hidden: nothing has to stay responsive, but timers are throttled. */
const HIDDEN_BUDGET_MS = 250
/** Initial and minimum tile size in pixels, small enough for weak integrated graphics. */
const START_TILE_PIXELS = 64 * 64
/** Share of the model color in the tint of glass; the rest is colorless. */
const GLASS_TINT = 0.15
/** Color of the hidden ceilings and levels above, which reflect light into the room. */
const CEILING = '#fafafa'

/** Tile grid for the desired pixels per tile, roughly square tiles. */
function tileGrid(width: number, height: number, tilePixels: number): [number, number] {
  const side = Math.sqrt(Math.max(tilePixels, START_TILE_PIXELS))
  return [Math.max(1, Math.ceil(width / side)), Math.max(1, Math.ceil(height / side))]
}

/**
 * Splits a mesh with several materials into one geometry per group. When merging,
 * three-gpu-pathtracer counts every mesh as one group, but the material list contains all
 * materials of a mesh: after the first multi-material mesh all following assignments are shifted
 * (wrong colors).
 */
function groupParts(geometry: BufferGeometry, materials: Material[], cache: Map<BufferGeometry, BufferGeometry[]>): [BufferGeometry, Material][] {
  const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }]
  let parts = cache.get(geometry)
  if (!parts) {
    const index = geometry.index
    const total = index ? index.count : geometry.getAttribute('position').count
    parts = groups.map(({ start, count }) => {
      // Only take the vertices of the group, otherwise the path tracer duplicates all attributes per part
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
        // Same data type, so normalized attributes (e.g. colors) keep their meaning
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

type IndoorUniforms = typeof indoorUniforms

/**
 * Copy of the indoor light maps. The live maps are rewritten in place whenever the sun moves, a
 * queued photo has to keep the state of the moment it was requested.
 */
function snapshotIndoor(): IndoorUniforms {
  const u = indoorUniforms
  const copy = (texture: DataTexture) => {
    const { data, width, height } = texture.image
    const result = new DataTexture((data as Uint16Array).slice(), width, height, texture.format as PixelFormat, texture.type)
    result.magFilter = texture.magFilter
    result.minFilter = texture.minFilter
    result.needsUpdate = true
    return result
  }
  return {
    indoorMap: { value: copy(u.indoorMap.value) },
    indoorRooms: { value: copy(u.indoorRooms.value) },
    indoorGrid: { value: u.indoorGrid.value.clone() },
    indoorSize: { value: u.indoorSize.value.clone() },
    indoorLevels: { value: u.indoorLevels.value.map((v) => v.clone()) },
    indoorCount: { value: u.indoorCount.value },
    indoorEnabled: { value: u.indoorEnabled.value },
    indoorAdapt: { value: u.indoorAdapt.value },
  }
}

/** Everything a queued photo needs, captured when it is requested and independent of the live view. */
export interface PhotoSnapshot {
  /** Meshes in world space and lights; the sky environment is added per render. */
  scene: ThreeScene
  sunDirection: Vector3
  environmentIntensity: number
  camera: { position: Vector3; quaternion: Quaternion; fov: number; near: number; far: number }
  exposure: number
  /** Per-room adaptation as in the aerial view, null when it is off. */
  indoor: IndoorUniforms | null
  dispose: () => void
}

/**
 * Copy of the visible scene for the path tracer: meshes with their world transform (geometries and
 * materials shared, glass as a thin transmissive pane), sun and lamps. The sky comes from a cube
 * environment that the path tracer samples itself, see {@link renderPhoto}.
 */
export function snapshotPhotoScene(source: Scene, sourceCamera: Camera): PhotoSnapshot {
  const scene = new ThreeScene()
  const glass = new Map<Material, Material>()
  const toPhoto = (m: Material) => {
    if (!m.userData.glass) return m
    let result = glass.get(m)
    if (!result) {
      const physical = (m as MeshPhysicalMaterial).clone()
      // The path tracer tints transmitted light with the material color; glass from models is mostly
      // dark and only looks transparent in the rasterizer through its opacity. Thickness 0: thin pane
      physical.color = new Color('#ffffff').lerp(physical.color, GLASS_TINT)
      Object.assign(physical, { transmission: 1, opacity: 1, transparent: false, roughness: 0, metalness: 0, thickness: 0 })
      result = physical
      glass.set(m, result)
    }
    return result
  }
  // Part geometries of multi-material meshes, once per geometry
  const split = new Map<BufferGeometry, BufferGeometry[]>()
  const hidden = new MeshStandardMaterial({ color: CEILING, roughness: 0.9, side: DoubleSide })
  // Invisible to the camera but still blocks light (see hideMatteFromCamera)
  Object.assign(hidden, { matte: true })
  source.updateMatrixWorld(true)
  // Sun position as in the 3D view: direction from the sun to the target
  const sunDirection = new Vector3(0, 1, 0)
  source.traverseVisible((object) => {
    if (object.userData.photo === false) return
    if (object instanceof Mesh) {
      // Parts that only cast shadows in the 3D view: ceilings in the aerial view and levels above
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
  sourceCamera.updateMatrixWorld()
  const perspective = sourceCamera as PerspectiveCamera
  const position = new Vector3().setFromMatrixPosition(sourceCamera.matrixWorld)
  if (position.length() === 0) position.set(0, 500, 500)
  const indoor = indoorUniforms.indoorAdapt.value > 0 ? snapshotIndoor() : null
  return {
    scene,
    sunDirection,
    environmentIntensity: source.environmentIntensity,
    camera: {
      position,
      quaternion: new Quaternion().setFromRotationMatrix(sourceCamera.matrixWorld),
      fov: perspective.fov,
      near: perspective.near,
      far: perspective.far,
    },
    // Adapted to interiors like the 3D view (observer); per room in the aerial view, see indoor
    exposure: currentExposure(),
    indoor,
    dispose: () => {
      glass.forEach((m) => m.dispose())
      hidden.dispose()
      split.forEach((parts) => parts.forEach((g) => g.dispose()))
      indoor?.indoorMap.value.dispose()
      indoor?.indoorRooms.value.dispose()
    },
  }
}

/** Sky as a cube environment in the context of the photo renderer. */
function addEnvironment(snapshot: PhotoSnapshot, renderer: WebGLRenderer): () => void {
  const target = new WebGLCubeRenderTarget(512)
  const environment = new ThreeScene()
  const sky = createSky(snapshot.sunDirection)
  sky.scale.setScalar(50)
  const ground = new Mesh(new CircleGeometry(40, 32), new MeshBasicMaterial({ color: GROUND_BOUNCE }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -1
  environment.add(sky, ground)
  new CubeCamera(0.1, 100, target).update(renderer, environment)
  const { scene } = snapshot
  scene.environment = target.texture
  scene.environmentIntensity = snapshot.environmentIntensity
  scene.background = target.texture
  return () => {
    scene.environment = null
    scene.background = null
    target.dispose()
    sky.geometry.dispose()
    sky.material.dispose()
    ground.geometry.dispose()
    ground.material.dispose()
  }
}

/**
 * Per-room adaptation as in the aerial view (see indoorLight): per pixel of the photo the factor
 * by which the light of the visible surface is raised (channel r, 1 outdoors). Ceilings that are
 * invisible to the camera do not count.
 */
function adaptationImage(renderer: WebGLRenderer, scene: ThreeScene, camera: Camera, uniforms: IndoorUniforms, width: number, height: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter })
  const material = new ShaderMaterial({
    uniforms,
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
        // Look up slightly in front of the surface, as in the 3D view
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

/** Makes the path tracer output multiply every pixel with the adaptation image before tone mapping. */
function applyAdaptation(output: ShaderMaterial, adaptation: WebGLRenderTarget) {
  output.uniforms.adaptationMap = { value: adaptation.texture }
  output.fragmentShader = output.fragmentShader
    .replace('uniform float opacity;', 'uniform float opacity;\nuniform sampler2D adaptationMap;')
    .replace('res.xyz = toneMapping( res.xyz );', 'res.xyz = toneMapping( res.xyz * texelFetch( adaptationMap, px, 0 ).r );')
  output.needsUpdate = true
}

/** Runs {@code step} once per animation frame, or as soon as possible while the tab is hidden (no frames there). */
function schedule(step: () => void): () => void {
  let frame = 0
  let timer = 0
  if (document.hidden) timer = window.setTimeout(step, 0)
  else frame = requestAnimationFrame(step)
  return () => {
    cancelAnimationFrame(frame)
    window.clearTimeout(timer)
  }
}

export interface PhotoCallbacks {
  onState: (state: 'rendering') => void
  onProgress: (samples: number) => void
  onDone: () => void
  onError: () => void
}

/**
 * Photorealistic still image of a snapshot by path tracing: light is traced physically (indirect
 * light, soft shadows, reflections, glass); the image gets less noisy with every pass. Renders
 * into {@code canvas} and returns a function that stops rendering and frees the GPU resources.
 */
export function renderPhoto(snapshot: PhotoSnapshot, canvas: HTMLCanvasElement, width: number, height: number, maxSamples: number, callbacks: PhotoCallbacks): () => void {
  const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = snapshot.exposure
  const { position, quaternion, fov, near, far } = snapshot.camera
  const camera = new PerspectiveCamera(fov, width / height, near, far)
  camera.position.copy(position)
  camera.quaternion.copy(quaternion)
  camera.updateMatrixWorld()
  const { scene } = snapshot
  const disposeEnvironment = addEnvironment(snapshot, renderer)
  const tracer = new WebGLPathTracer(renderer)
  // Missing from the library's types
  const internals = tracer as unknown as {
    isCompiling: boolean
    _pathTracer: { material: ShaderMaterial & { onBeforeRender: () => void } }
    _quad: { material: ShaderMaterial }
  }
  const adaptation = snapshot.indoor ? adaptationImage(renderer, scene, camera, snapshot.indoor, width, height) : null
  if (adaptation) applyAdaptation(internals._quad.material, adaptation)
  // Smaller shader that compiles fast enough on weak graphics too
  slimPathTracerShader(internals._pathTracer.material, scene)
  tracer.bounces = 5
  tracer.transmissiveBounces = 4
  // Fewer specular fireflies on rough reflections
  tracer.filterGlossyFactor = 0.5
  tracer.minSamples = 1
  tracer.renderDelay = 0
  tracer.fadeDuration = 0
  // Small tiles: the driver resets long GPU commands as hung (context lost).
  // The size adapts to the measured time after every pass.
  tracer.tiles.set(...tileGrid(width, height, START_TILE_PIXELS))
  // Only show the path tracing result, not the rasterized scene below it
  tracer.rasterizeScene = false
  // Build the acceleration structure in worker threads so the page stays responsive
  const worker = new ParallelMeshBVHWorker()
  tracer.setBVHWorker(worker)
  let cancelStep = () => {}
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    cancelStep()
    tracer.dispose()
    worker.dispose()
    adaptation?.dispose()
    disposeEnvironment()
    renderer.dispose()
    // Browsers only allow a few WebGL contexts and drop the oldest one, possibly the 3D view's
    renderer.forceContextLoss()
  }
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    if (stopped) return
    stop()
    callbacks.onError()
  })
  tracer
    .setSceneAsync(scene, camera)
    .then(() => {
      if (stopped) return
      compileOnce(internals._pathTracer.material)
      callbacks.onState('rendering')
      // Reading back one pixel waits until the GPU has finished the tile, which measures its time
      const pixel = new Float32Array(4)
      let spent = 0 // measured time and pixels in the current pass
      let measured = 0
      let warmedUp = false
      let previous = 0
      const loop = () => {
        if (stopped) return
        // The shader is still compiling: do not wait for the GPU, the page would hang
        if (internals.isCompiling) {
          cancelStep = schedule(loop)
          return
        }
        const frameStart = performance.now()
        const budget = document.hidden ? HIDDEN_BUDGET_MS : FRAME_BUDGET_MS
        let done = previous
        do {
          const tilePixels = (width / tracer.tiles.x) * (height / tracer.tiles.y)
          const tileStart = performance.now()
          tracer.renderSample()
          renderer.readRenderTargetPixels(tracer.target, 0, 0, 1, 1, pixel)
          // The first tile includes uploading the scene and does not count
          if (warmedUp) {
            spent += performance.now() - tileStart
            measured += tilePixels
          }
          warmedUp = true
          // samples counts proportionally per tile
          done = Math.floor(tracer.samples)
          if (done > previous && measured > 0) {
            // Pass finished: size tiles by the mean time per pixel, at most four times larger
            tracer.tiles.set(...tileGrid(width, height, Math.min((TILE_BUDGET_MS * measured) / spent, tilePixels * 4)))
            spent = measured = 0
          }
          if (done > previous) callbacks.onProgress(done)
          previous = done
        } while (done < maxSamples && !stopped && performance.now() - frameStart < budget)
        if (stopped) return
        if (done >= maxSamples) {
          callbacks.onDone()
          return
        }
        cancelStep = schedule(loop)
      }
      cancelStep = schedule(loop)
    })
    .catch(() => {
      if (stopped) return
      stop()
      callbacks.onError()
    })
  return stop
}
