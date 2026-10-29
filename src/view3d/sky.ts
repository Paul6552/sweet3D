import { Color, MathUtils, Vector3 } from 'three'
import { Sky as PhysicalSky } from 'three/examples/jsm/objects/Sky.js'

/** Farbe am Horizont bei Tag; Nebel und Himmel treffen sich dort, damit der Boden weich ausläuft. */
export const HORIZON = '#d6e2ec'
/** Horizont bei Nacht. */
const NIGHT_HORIZON = '#0e1522'
/** Stärke des Umgebungslichts aus dem Himmel neben der Sonne; der Himmel selbst ist sehr hell (HDR). */
export const ENVIRONMENT_INTENSITY = 0.25
/** Rest an Umgebungslicht bei Nacht (Mond, Streulicht), damit das Haus nicht ganz schwarz ist. */
const NIGHT_ENVIRONMENT = 0.02
/** Mittlere Farbe des Rasens; unter dem Horizont der Umgebung, damit Wände von unten grünlich aufgehellt werden. */
export const GROUND_BOUNCE = '#5d6a45'
/** Stärke der Sonne bei hohem Stand. */
const SUN_INTENSITY = 2.4
const SUN_HIGH = new Color('#fff3e2')
const SUN_LOW = new Color('#ffb070')

/** Licht zu einem Sonnenstand, gemeinsam für Himmel, Sonne, Nebel und Foto-Modus. */
export interface Daylight {
  /** Einheitsvektor zur Sonne (auch unter dem Horizont). */
  direction: Vector3
  /** Sonnenhöhe in Grad. */
  elevation: number
  sunIntensity: number
  sunColor: Color
  environmentIntensity: number
  /** Stärke des schwachen Hemisphärenlichts, das einspringt, solange die Umgebung berechnet wird. */
  hemisphereIntensity: number
  horizon: Color
}

/**
 * Tag, Dämmerung und Nacht nach der Sonnenhöhe: tief stehende Sonne wird wärmer und schwächer,
 * unter dem Horizont geht sie aus, und das Umgebungslicht nimmt bis zur Nacht stark ab. Dann
 * beleuchten nur noch die Leuchten das Haus.
 */
export function daylight(direction: Vector3): Daylight {
  const elevation = MathUtils.radToDeg(Math.asin(MathUtils.clamp(direction.y, -1, 1)))
  const up = MathUtils.smoothstep(elevation, -1, 8)
  const day = MathUtils.smoothstep(elevation, -8, 6)
  return {
    direction,
    elevation,
    sunIntensity: SUN_INTENSITY * up * (0.6 + 0.4 * MathUtils.smoothstep(elevation, 5, 30)),
    sunColor: SUN_LOW.clone().lerp(SUN_HIGH, MathUtils.smoothstep(elevation, 2, 25)),
    environmentIntensity: MathUtils.lerp(NIGHT_ENVIRONMENT, ENVIRONMENT_INTENSITY, day),
    hemisphereIntensity: MathUtils.lerp(0.03, 0.15, day),
    horizon: new Color(NIGHT_HORIZON).lerp(new Color(HORIZON), day),
  }
}

/** Physikalischer Himmel (Rayleigh-/Mie-Streuung) mit leichten Wolken, Sonne in der gegebenen Richtung. */
export function createSky(sunDirection: Vector3): PhysicalSky {
  const sky = new PhysicalSky()
  const uniforms = sky.material.uniforms
  uniforms.turbidity.value = 3
  uniforms.rayleigh.value = 1.2
  uniforms.mieCoefficient.value = 0.004
  uniforms.mieDirectionalG.value = 0.8
  uniforms.cloudCoverage.value = 0.25
  uniforms.sunPosition.value.copy(sunDirection)
  return sky
}
