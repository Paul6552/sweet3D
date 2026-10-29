import { Vector3 } from 'three'
import { Sky as PhysicalSky } from 'three/examples/jsm/objects/Sky.js'

/** Farbe am Horizont; Nebel und Himmel treffen sich dort, damit der Boden weich ausläuft. */
export const HORIZON = '#d6e2ec'
/**
 * Richtung zur Sonne (etwa 42° hoch, links hinter der Standard-Luftansicht), damit die sichtbaren
 * Fassaden beleuchtet sind und Schatten ins Bild fallen. Himmel, Umgebungslicht und Schatten passen dazu.
 */
export const SUN_DIRECTION = new Vector3(-0.75, 0.72, 0.38).normalize()
/** Stärke des Umgebungslichts aus dem Himmel neben der Sonne; der Himmel selbst ist sehr hell (HDR). */
export const ENVIRONMENT_INTENSITY = 0.25
/** Mittlere Farbe des Rasens; unter dem Horizont der Umgebung, damit Wände von unten grünlich aufgehellt werden. */
export const GROUND_BOUNCE = '#5d6a45'

/** Physikalischer Himmel (Rayleigh-/Mie-Streuung) mit leichten Wolken. */
export function createSky(): PhysicalSky {
  const sky = new PhysicalSky()
  const uniforms = sky.material.uniforms
  uniforms.turbidity.value = 3
  uniforms.rayleigh.value = 1.2
  uniforms.mieCoefficient.value = 0.004
  uniforms.mieDirectionalG.value = 0.8
  uniforms.cloudCoverage.value = 0.25
  uniforms.sunPosition.value.copy(SUN_DIRECTION)
  return sky
}
