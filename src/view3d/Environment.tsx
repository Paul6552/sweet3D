import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BackSide, Color, type Mesh, RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader } from 'three'

/** Farbe am Horizont; Nebel und Himmel treffen sich dort, damit der Boden weich ausläuft. */
export const HORIZON = '#dbe8f2'
const ZENITH = '#4f8fd0'
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

/** Himmelskuppel mit Verlauf vom Horizont zum Zenit; wandert mit der Kamera mit. */
export function Sky() {
  const mesh = useRef<Mesh>(null)
  const uniforms = useMemo(() => ({ horizon: { value: new Color(HORIZON) }, zenith: { value: new Color(ZENITH) } }), [])
  useFrame(({ camera }) => mesh.current?.position.copy(camera.position))
  return (
    <mesh ref={mesh} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS, 32, 16]} />
      <shaderMaterial
        side={BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vDirection;
          void main() {
            vDirection = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`}
        fragmentShader={`
          uniform vec3 horizon;
          uniform vec3 zenith;
          varying vec3 vDirection;
          void main() {
            float h = max(vDirection.y, 0.0);
            gl_FragColor = vec4(mix(horizon, zenith, pow(h, 0.6)), 1.0);
            #include <colorspace_fragment>
          }`}
      />
    </mesh>
  )
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
