import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import {
  BufferAttribute,
  CircleGeometry,
  ClampToEdgeWrapping,
  CubeCamera,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLCubeRenderTarget,
} from 'three'
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js'
import type { MultiPolygon } from 'polygon-clipping'
import { setSkyIrradiance } from './eyeAdaptation'
import { argbToCss } from '../model/colors'
import { clipping } from '../model/clipping'
import { backgroundImageTransform, imageToPlan, planToImage, type BackgroundImage, type Surface } from '../model/home'
import { groundGeometry, polygonsGeometry } from './groundHoles'
import { type GroundUniforms, patchGroundShader } from './groundShader'
import { loadImage } from './materials'
import { createSky, type Daylight, GROUND_BOUNCE } from './sky'

/** Default lawn from the texture catalog of Sweet Home 3D; tile larger than in the catalog so the pattern does not repeat from afar. */
const LAWN = { color: '/catalog/resources/textures/grass.jpg', tile: 200, tint: '#dfe6cf' }
/** Shown while the textures load. */
const LAWN_COLOR = '#5f7a3c'
const GROUND_SIZE = 400000
const SKY_RADIUS = 200000

/**
 * Himmelskuppel, die mit der Kamera mitwandert, und daraus berechnetes Umgebungslicht
 * (scene.environment): alle physikalisch basierten Materialien werden vom Himmel beleuchtet
 * und spiegeln ihn je nach Rauheit.
 */
export function Sky({ environmentSize, daylight }: { environmentSize: number; daylight: Daylight }) {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const { direction, environmentIntensity } = daylight
  const sky = useMemo(() => {
    const created = createSky(direction)
    created.scale.setScalar(SKY_RADIUS)
    created.renderOrder = -1
    created.frustumCulled = false
    // Im Foto-Modus liefert die Umgebung den Himmel
    created.userData.photo = false
    return created
    // Neue Richtung kommt über das Uniform unten, die Kuppel bleibt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    sky.material.uniforms.sunPosition.value.copy(direction)
  }, [sky, direction])
  useEffect(() => {
    const generator = new PMREMGenerator(gl)
    const environment = new Scene()
    const envSky = createSky(direction)
    envSky.scale.setScalar(50)
    // Wolken bewegen sich nicht, damit das Umgebungslicht nur einmal berechnet werden muss
    envSky.material.uniforms.cloudCoverage.value = 0.25
    const ground = new Mesh(new CircleGeometry(40, 32), new MeshBasicMaterial({ color: GROUND_BOUNCE }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -1
    environment.add(envSky, ground)
    const target = generator.fromScene(environment, 0, 0.1, 100, { size: environmentSize })
    const { scene } = get()
    scene.environment = target.texture
    // Himmelslicht auf eine waagrechte Fläche, als Maßstab für die Augenanpassung
    let cancelled = false
    const cube = new WebGLCubeRenderTarget(16, { type: HalfFloatType })
    new CubeCamera(0.1, 100, cube).update(gl, environment)
    void LightProbeGenerator.fromCubeRenderTarget(gl, cube)
      .then((probe) => {
        // Ergebnis als rgb in x, y, z
        const irradiance = probe.sh.getIrradianceAt(new Vector3(0, 1, 0), new Vector3())
        if (!cancelled) setSkyIrradiance(0.2126 * irradiance.x + 0.7152 * irradiance.y + 0.0722 * irradiance.z)
      })
      .catch(() => {})
      .finally(() => cube.dispose())
    return () => {
      cancelled = true
      scene.environment = null
      target.dispose()
      generator.dispose()
      envSky.geometry.dispose()
      envSky.material.dispose()
      ground.geometry.dispose()
      ground.material.dispose()
    }
  }, [gl, get, environmentSize, direction])
  useEffect(() => {
    get().scene.environmentIntensity = environmentIntensity
  }, [get, environmentIntensity])
  useEffect(() => () => {
    sky.geometry.dispose()
    sky.material.dispose()
  }, [sky])
  useFrame(({ camera }) => sky.position.copy(camera.position))
  return <primitive object={sky} />
}

const NO_HOLES: MultiPolygon = []
const DEFAULT_GROUND: Surface = { color: null, texture: null }

interface GroundLook {
  color: string
  map: HTMLImageElement | null
  normal: HTMLImageElement | null
  roughness: HTMLImageElement | null
  tile: [number, number]
  variation: number
}

const optionalImage = (image: string | undefined) => (image ? loadImage(image).catch(() => null) : Promise.resolve(null))

/** Images and parameters for the ground surface: default lawn, plain color or texture. */
async function groundLook(ground: Surface): Promise<GroundLook> {
  if (ground.texture) {
    const { image, maps, width, height } = ground.texture
    const [map, normal, roughness] = await Promise.all([optionalImage(image), optionalImage(maps?.normal), optionalImage(maps?.roughness)])
    return { color: '#ffffff', map, normal, roughness, tile: [width || 100, height || 100], variation: 0.5 }
  }
  if (ground.color != null) return { color: argbToCss(ground.color), map: null, normal: null, roughness: null, tile: [100, 100], variation: 0.35 }
  const map = await optionalImage(LAWN.color)
  return { color: LAWN.tint, map, normal: null, roughness: null, tile: [LAWN.tile, LAWN.tile], variation: 1 }
}

function groundMaterial(look: GroundLook | null, anisotropy: number): MeshStandardMaterial {
  const texture = (image: HTMLImageElement | null, color: boolean) => {
    if (!image || !look) return null
    const t = new Texture(image)
    t.wrapS = t.wrapT = RepeatWrapping
    // The shader computes its own coordinates; the repeat is for the path tracer of the photo mode
    t.repeat.set(GROUND_SIZE / look.tile[0], GROUND_SIZE / look.tile[1])
    t.colorSpace = color ? SRGBColorSpace : NoColorSpace
    // Sharp also at grazing angles, otherwise the lawn blurs towards the horizon
    t.anisotropy = anisotropy
    t.needsUpdate = true
    return t
  }
  const roughnessMap = texture(look?.roughness ?? null, false)
  const material = new MeshStandardMaterial({
    color: look?.color ?? LAWN_COLOR,
    roughness: 1,
    map: texture(look?.map ?? null, true),
    normalMap: texture(look?.normal ?? null, false),
    normalScale: new Vector2(0.8, 0.8),
    roughnessMap,
  })
  const uniforms: GroundUniforms = {
    groundTile: { value: look?.tile ?? [100, 100] },
    groundVariation: { value: look?.variation ?? 0.5 },
    groundFade: { value: [1500, 30000] },
  }
  material.onBeforeCompile = (shader) => patchGroundShader(shader, uniforms)
  material.customProgramCacheKey = () => 'ground'
  return material
}

/**
 * Ground up to the horizon just below the terrain, fixed at the origin so the pattern does not
 * move. The user chooses its look (default lawn, color or texture) in the environment dialog.
 * Above basements it has holes ({@link groundHoles}) and then, as soil, also keeps the sun away
 * from basement windows below the terrain.
 */
export function Ground({ holes = NO_HOLES, ground = DEFAULT_GROUND }: { holes?: MultiPolygon; ground?: Surface }) {
  const gl = useThree((s) => s.gl)
  const [look, setLook] = useState<GroundLook | null>(null)
  const key = JSON.stringify(ground)
  useEffect(() => {
    let cancelled = false
    void groundLook(JSON.parse(key) as Surface).then((loaded) => !cancelled && setLook(loaded))
    return () => {
      cancelled = true
    }
  }, [key])
  const material = useMemo(() => groundMaterial(look, gl.capabilities.getMaxAnisotropy()), [look, gl])
  useEffect(
    () => () => {
      for (const map of [material.map, material.normalMap, material.roughnessMap]) map?.dispose()
      material.dispose()
    },
    [material],
  )
  const geometry = useMemo(() => groundGeometry(GROUND_SIZE, holes), [holes])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh rotation-x={-Math.PI / 2} position-y={-0.5} geometry={geometry} material={material} receiveShadow castShadow={holes.length > 0} />
}

/**
 * Background image of the plan (e.g. an aerial photo) on the ground of the 3D view, like
 * "backgroundImageVisibleOnGround3D" in Sweet Home 3D: the image rectangle lies just above the
 * ground, which continues around it, with the same holes above basements. A plain textured
 * material with real texture coordinates, so the path tracer of the photo mode renders it as is.
 */
export function AerialGround({ backgroundImage, holes = NO_HOLES }: { backgroundImage: BackgroundImage; holes?: MultiPolygon }) {
  const gl = useThree((s) => s.gl)
  const [loaded, setLoaded] = useState<{ ref: string; image: HTMLImageElement } | null>(null)
  useEffect(() => {
    let cancelled = false
    const ref = backgroundImage.image
    void loadImage(ref)
      .then((image) => !cancelled && image && setLoaded({ ref, image }))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [backgroundImage.image])
  const image = loaded?.ref === backgroundImage.image ? loaded.image : null

  const material = useMemo(() => {
    if (!image) return null
    const map = new Texture(image)
    map.colorSpace = SRGBColorSpace
    map.wrapS = map.wrapT = ClampToEdgeWrapping
    map.anisotropy = gl.capabilities.getMaxAnisotropy()
    map.needsUpdate = true
    // Pulled towards the camera so it never flickers with the ground below
    return new MeshStandardMaterial({ map, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  }, [image, gl])
  useEffect(
    () => () => {
      material?.map?.dispose()
      material?.dispose()
    },
    [material],
  )

  const geometry = useMemo(() => {
    if (!image) return null
    const width = image.naturalWidth
    const height = image.naturalHeight
    const transform = backgroundImageTransform(backgroundImage)
    const corners = ([[0, 0], [width, 0], [width, height], [0, height], [0, 0]] as [number, number][]).map((p) => imageToPlan(transform, p))
    let area: MultiPolygon = [[corners]]
    if (holes.length > 0) {
      try {
        area = clipping.difference(area, holes)
      } catch {
        // Without holes rather than without the image
      }
    }
    const created = polygonsGeometry(area)
    const position = created.getAttribute('position')
    const uv = new Float32Array(position.count * 2)
    for (let i = 0; i < position.count; i++) {
      const [x, y] = planToImage(transform, [position.getX(i), -position.getY(i)])
      uv[2 * i] = x / width
      uv[2 * i + 1] = 1 - y / height
    }
    created.setAttribute('uv', new BufferAttribute(uv, 2))
    return created
  }, [image, backgroundImage, holes])
  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry || !material) return null
  return <mesh rotation-x={-Math.PI / 2} position-y={-0.3} geometry={geometry} material={material} receiveShadow />
}
