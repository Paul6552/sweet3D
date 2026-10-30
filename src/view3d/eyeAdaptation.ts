import { useFrame } from '@react-three/fiber'
import { MathUtils } from 'three'
import { indoorLightAt } from './indoorLight'
import type { Daylight } from './sky'

/** Höchste Belichtung: das Auge gleicht dunkle Räume nicht ganz aus. */
const MAX_EXPOSURE = 4
/** Zeitkonstante der Anpassung in Sekunden. */
const ADAPTATION_TIME = 0.8

/** Bestrahlungsstärke einer waagrechten Fläche im Freien durch den Himmel bei Umgebungsstärke 1 (siehe Sky). */
let skyIrradiance = 1
let exposure = 1

export function setSkyIrradiance(value: number) {
  skyIrradiance = value
}

/** Aktuelle Belichtung der 3D-Ansicht, auch für den Foto-Modus. */
export function currentExposure(): number {
  return exposure
}

/**
 * Augenanpassung: Steht die Kamera in einem überdachten Raum, wird die Belichtung um so viel
 * angehoben, wie der Raum dunkler ist als das Himmelslicht im Freien (höchstens {@link MAX_EXPOSURE});
 * im Freien ist sie 1. Der Wechsel geschieht weich wie beim Auge.
 */
export function EyeAdaptation({ light, enabled }: { light: Daylight; enabled: boolean }) {
  useFrame(({ gl, camera }, delta) => {
    const inside = enabled ? indoorLightAt(camera.position) : null
    const outside = skyIrradiance * light.environmentIntensity
    const target = inside ? MathUtils.clamp(outside / Math.max(1e-6, inside.sky * outside + inside.fill), 1, MAX_EXPOSURE) : 1
    exposure += (target - exposure) * (1 - Math.exp(-Math.min(delta, 1) / ADAPTATION_TIME))
    gl.toneMappingExposure = exposure
  })
  return null
}
