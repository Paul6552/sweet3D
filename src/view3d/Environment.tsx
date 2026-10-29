import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three'
import { createSky, type Daylight, GROUND_BOUNCE } from './sky'

/** Rasen aus dem Texturkatalog von Sweet Home 3D. */
const GRASS = '/catalog/resources/textures/grass.jpg'
/** Größe einer Kachel in cm; größer als im Katalog, damit sich das Muster aus der Ferne nicht wiederholt. */
const GRASS_TILE = 200
const GROUND_SIZE = 400000
const SKY_RADIUS = 200000
/**
 * Mischt die Kachel mit einer gedrehten, größeren Kopie von sich selbst, damit aus der Ferne
 * keine Streifen durch die Wiederholung entstehen.
 */
function mixTiles(shader: { fragmentShader: string }) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#ifdef USE_MAP
      vec4 tileA = texture2D(map, vMapUv);
      vec4 tileB = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.29);
      diffuseColor *= mix(tileA, tileB, 0.5);
    #endif`,
  )
}

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
    return () => {
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

/** Rasenfläche bis zum Horizont, knapp unter dem Fußboden der untersten Ebene; fest am Ursprung, damit das Muster nicht wandert. */
export function Ground() {
  const gl = useThree((s) => s.gl)
  const texture = useMemo<Texture>(() => {
    const t = new TextureLoader().load(GRASS)
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(GROUND_SIZE / GRASS_TILE, GROUND_SIZE / GRASS_TILE)
    t.colorSpace = SRGBColorSpace
    // Scharf auch unter flachem Blickwinkel, sonst verschwimmt der Rasen zum Horizont hin
    t.anisotropy = gl.capabilities.getMaxAnisotropy()
    return t
  }, [gl])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.5} receiveShadow>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
      <meshStandardMaterial map={texture} color="#dfe6cf" roughness={1} onBeforeCompile={mixTiles} />
    </mesh>
  )
}
