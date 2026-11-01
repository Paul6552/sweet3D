import { useFrame } from '@react-three/fiber'
import { MathUtils } from 'three'
import { indoorLightAt } from './indoorLight'
import type { Daylight } from './sky'

/** Höchste Belichtung: das Auge gleicht auch sehr dunkle Räume nicht ganz aus. */
const MAX_EXPOSURE = 12
/** Helligkeit eines Raums nach der Anpassung im Verhältnis zum Freien: innen bleibt etwas dunkler. */
const INDOOR_KEY = 0.8
/** Zeitkonstante der Anpassung in Sekunden. */
const ADAPTATION_TIME = 0.8

/** Bestrahlungsstärke einer waagrechten Fläche im Freien durch den Himmel bei Umgebungsstärke 1 (siehe Sky). */
let skyIrradiance = 1
let exposure = 1
const skyListeners = new Set<() => void>()

export function setSkyIrradiance(value: number) {
  skyIrradiance = value
  skyListeners.forEach((listener) => listener())
}

/** Meldet, wenn das Himmelslicht neu gemessen wurde; gibt die Abmeldung zurück. */
export function onSkyIrradiance(listener: () => void): () => void {
  skyListeners.add(listener)
  return () => skyListeners.delete(listener)
}

/** Himmelslicht auf eine waagrechte Fläche im Freien bei diesem Tageslicht. */
export function outdoorIrradiance(light: Daylight): number {
  return skyIrradiance * light.environmentIntensity
}

/** Aktuelle Belichtung der 3D-Ansicht, auch für den Foto-Modus. */
export function currentExposure(): number {
  return exposure
}

/**
 * Anpassung des Auges an einen überdachten Raum: so viel heller, wie der Raum (Anteil {@code sky}
 * des Himmelslichts und zurückgeworfenes Licht {@code fill}) dunkler ist als das Freie
 * ({@code outside}), zwischen 1 und {@link MAX_EXPOSURE}.
 */
export function adaptationFor(sky: number, fill: number, outside: number): number {
  return MathUtils.clamp((INDOOR_KEY * outside) / Math.max(1e-6, sky * outside + fill), 1, MAX_EXPOSURE)
}

/**
 * Augenanpassung: Steht die Kamera in einem überdachten Raum, wird die Belichtung an den Raum
 * angepasst (siehe {@link adaptationFor}); im Freien ist sie 1. Der Wechsel geschieht weich wie beim Auge.
 */
export function EyeAdaptation({ light, enabled }: { light: Daylight; enabled: boolean }) {
  useFrame(({ gl, camera }, delta) => {
    const inside = enabled ? indoorLightAt(camera.position) : null
    const target = inside ? adaptationFor(inside.sky, inside.fill, outdoorIrradiance(light)) : 1
    exposure += (target - exposure) * (1 - Math.exp(-Math.min(delta, 1) / ADAPTATION_TIME))
    gl.toneMappingExposure = exposure
  })
  return null
}
