import { ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'

/**
 * Shader patch for the ground of the 3D view (lawn or any texture/color chosen by the user):
 * - texture coordinates come from the plane position in cm, so the tile size is a uniform
 * - texture repetition is hidden by blending two randomly offset lookups, with the offset changing
 *   along a smooth noise (Inigo Quilez, "texture repetition", technique 3); color, normal and
 *   roughness maps use the same offsets so they stay aligned
 * - large patches of lighter, darker and drier ground break up the uniform surface
 * - with distance the texture fades into its average color and the normal map flattens, which
 *   removes moiré and stripes towards the horizon
 */
export interface GroundUniforms {
  /** Size of one texture tile in cm. */
  groundTile: { value: [number, number] }
  /** Strength of the large scale color variation, 0 to 1. */
  groundVariation: { value: number }
  /** Distances in cm where the fade to the average color starts and ends. */
  groundFade: { value: [number, number] }
}

const VERTEX_PREFIX = /* glsl */ `
varying vec2 vGroundPos;
`

const FRAGMENT_PREFIX = /* glsl */ `
uniform vec2 groundTile;
uniform float groundVariation;
uniform vec2 groundFade;
varying vec2 vGroundPos;

float groundHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float groundNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(groundHash(i), groundHash(i + vec2(1.0, 0.0)), u.x), mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

/** Computes the shared lookup offsets and blend weight; runs before the map lookup. */
const SETUP = /* glsl */ `
vec2 groundUv = vGroundPos / groundTile;
vec2 groundDx = dFdx(groundUv);
vec2 groundDy = dFdy(groundUv);
float groundL = groundNoise(groundUv * 0.7) * 8.0;
float groundI = floor(groundL);
vec2 groundOffA = sin(vec2(3.0, 7.0) * groundI);
vec2 groundOffB = sin(vec2(3.0, 7.0) * (groundI + 1.0));
float groundF = fract(groundL);
float groundW = smoothstep(0.2, 0.8, groundF);
float groundFar = smoothstep(groundFade.x, groundFade.y, length(vViewPosition));
`

const sample = (map: string) =>
  `mix(textureGrad(${map}, groundUv + groundOffA, groundDx, groundDy), textureGrad(${map}, groundUv + groundOffB, groundDx, groundDy), groundW)`

const MAP = /* glsl */ `
#ifdef USE_MAP
  vec4 groundA = textureGrad(map, groundUv + groundOffA, groundDx, groundDy);
  vec4 groundB = textureGrad(map, groundUv + groundOffB, groundDx, groundDy);
  // Blend where both lookups look alike, so the seam is hard to see
  groundW = smoothstep(0.2, 0.8, groundF - 0.1 * dot(groundA.rgb - groundB.rgb, vec3(1.0)));
  vec4 groundColor = mix(groundA, groundB, groundW);
  // Highest mip level = average color of the texture
  groundColor = mix(groundColor, textureLod(map, vec2(0.5), 16.0), groundFar);
  diffuseColor *= groundColor;
#endif
{
  // Large patches in m: brightness on two scales, dry yellowish areas
  vec2 m = vGroundPos * 0.01;
  float bright = groundNoise(m * 0.23) * 0.55 + groundNoise(m * 0.06 + 3.1) * 0.3 + groundNoise(m * 0.9 + 7.7) * 0.15;
  float dry = smoothstep(0.55, 0.9, groundNoise(m * 0.11 + 11.3));
  vec3 tint = mix(vec3(1.0), vec3(1.08, 1.03, 0.8), dry * groundVariation);
  diffuseColor.rgb *= tint * mix(1.0 - 0.16 * groundVariation, 1.0 + 0.12 * groundVariation, bright);
}
`

/**
 * Adds the ground shader to a MeshStandardMaterial; the varying is filled from the plane's local
 * position (cm), which matches the orientation of the plane's uv, so the tangent frame of the
 * normal map stays valid.
 */
export function patchGroundShader(shader: WebGLProgramParametersWithUniforms, uniforms: GroundUniforms): void {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = VERTEX_PREFIX + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = position.xy;')
  shader.fragmentShader =
    FRAGMENT_PREFIX +
    shader.fragmentShader
      .replace('#include <map_fragment>', SETUP + MAP)
      .replace('#include <roughnessmap_fragment>', ShaderChunk.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', sample('roughnessMap')))
      .replace(
        '#include <normal_fragment_maps>',
        ShaderChunk.normal_fragment_maps
          .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `vec3 mapN = ${sample('normalMap')}.xyz * 2.0 - 1.0;`)
          .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - groundFar);'),
      )
}
