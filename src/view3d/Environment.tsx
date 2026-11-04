import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import {
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
import { backgroundImageTransform, imageToPlan, planToImage, type BackgroundImage, type Home, type Surface } from '../model/home'
import { TERRAIN_EXTENT, type TerrainFace, type TerrainPatch } from '../model/terrain'
import { type GroundUniforms, patchGroundShader } from './groundShader'
import { loadImage, surfaceMaterial } from './materials'
import { DEFAULT_ROCK, facesGeometry, groundUv, patchGeometry } from './terrainGeometry'
import { createSky, type Daylight, GROUND_BOUNCE } from './sky'

/** Default lawn from the texture catalog of Sweet Home 3D; tile larger than in the catalog so the pattern does not repeat from afar. */
const LAWN = { color: '/catalog/resources/textures/grass.jpg', tile: 200, tint: '#dfe6cf' }
/** Shown while the textures load. */
const LAWN_COLOR = '#5f7a3c'
/** Shown while the rock texture loads. */
const ROCK_COLOR = '#8d8579'
const GROUND_SIZE = 2 * TERRAIN_EXTENT
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

/** Terrain of the 3D view: visible patches and vertical faces, see model/terrain.ts. */
export interface TerrainScene {
  home: Pick<Home, 'terrain' | 'rooms' | 'walls'>
  patches: TerrainPatch[]
  faces: TerrainFace[]
}

const isDefaultSurface = (surface: Surface | null | undefined) => !surface || (surface.color == null && !surface.texture)

/**
 * Ground up to the horizon just below the terrain, fixed at the origin so the pattern does not
 * move. The user chooses its look (default lawn, color or texture) in the environment dialog.
 * Terrain areas lie at their own height with the same look (unless they have their own surface)
 * and end in rock faces or slopes. Where the house lies below the terrain (basements, a house
 * built into a hillside) the ground has holes and then, as soil, also keeps the sun away from
 * windows below the terrain.
 */
export function Ground({ terrain, ground = DEFAULT_GROUND }: { terrain: TerrainScene; ground?: Surface }) {
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
  const meshes = useMemo(() => {
    const { home, patches, faces } = terrain
    const tops = patches.map((patch) => {
      const own = !isDefaultSurface(patch.surface)
      const geometry = patchGeometry(home, patch)
      // The base ground lies just below the floors of the lowest level: as a shadow caster it
      // would cover them with shadow acne. It only needs to cast shadows into basements below it.
      const castShadow = patch.area !== null || patch.houseHoles.length > 0
      return { geometry: own ? geometry : groundUv(geometry, GROUND_SIZE), surface: own ? patch.surface : null, castShadow }
    })
    const byArea = new Map<number | null, TerrainFace[]>()
    for (const face of faces) byArea.set(face.area, [...(byArea.get(face.area) ?? []), face])
    const edges = [...byArea].map(([area, list]) => {
      const surface = area === null ? null : home.terrain[area]?.edgeSurface
      return { geometry: facesGeometry(list), surface: isDefaultSurface(surface) ? DEFAULT_ROCK : surface! }
    })
    return { tops, edges }
  }, [terrain])
  useEffect(() => () => [...meshes.tops, ...meshes.edges].forEach((m) => m.geometry.dispose()), [meshes])
  return (
    <group rotation-x={-Math.PI / 2} position-y={-0.5}>
      {meshes.tops.map((top, i) => (
        <mesh key={i} geometry={top.geometry} material={top.surface ? surfaceMaterial(top.surface, LAWN_COLOR) : material} receiveShadow castShadow={top.castShadow} />
      ))}
      {meshes.edges.map((edge, i) => (
        <mesh key={`edge${i}`} geometry={edge.geometry} material={surfaceMaterial(edge.surface, ROCK_COLOR)} receiveShadow castShadow />
      ))}
    </group>
  )
}

/**
 * Background image of the plan (e.g. an aerial photo) on the ground of the 3D view, like
 * "backgroundImageVisibleOnGround3D" in Sweet Home 3D: the image lies just above the terrain
 * (also on terraces and slopes), which continues around it, with the same holes for the house. A
 * plain textured material with real texture coordinates, so the path tracer of the photo mode
 * renders it as is.
 */
export function AerialGround({ backgroundImage, terrain }: { backgroundImage: BackgroundImage; terrain: TerrainScene }) {
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

  const geometries = useMemo(() => {
    if (!image) return []
    const width = image.naturalWidth
    const height = image.naturalHeight
    const transform = backgroundImageTransform(backgroundImage)
    const corners = ([[0, 0], [width, 0], [width, height], [0, height], [0, 0]] as [number, number][]).map((p) => imageToPlan(transform, p))
    const rect: MultiPolygon = [[corners]]
    return terrain.patches.flatMap((patch) => {
      let polygons: MultiPolygon
      try {
        polygons = clipping.intersection(rect, patch.polygons)
      } catch {
        return []
      }
      if (polygons.length === 0) return []
      const created = patchGeometry(terrain.home, { ...patch, polygons })
      const position = created.getAttribute('position')
      const uv = created.getAttribute('uv')
      for (let i = 0; i < position.count; i++) {
        const [x, y] = planToImage(transform, [position.getX(i), -position.getY(i)])
        uv.setXY(i, x / width, 1 - y / height)
      }
      return [created]
    })
  }, [image, backgroundImage, terrain])
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])

  if (!material) return null
  return (
    <group rotation-x={-Math.PI / 2} position-y={-0.3}>
      {geometries.map((geometry, i) => (
        <mesh key={i} geometry={geometry} material={material} receiveShadow />
      ))}
    </group>
  )
}
