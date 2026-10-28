/**
 * Umrechnung der Besucher-Blickrichtung. Sweet Home 3D blickt bei yaw in Richtung
 * (-sin yaw, cos yaw) und neigt bei positivem pitch nach unten; Sweet3D blickt in Richtung
 * (cos yaw, sin yaw) und neigt bei positivem pitch nach oben.
 */
const TWO_PI = 2 * Math.PI

const normalize = (angle: number) => ((angle % TWO_PI) + TWO_PI) % TWO_PI

export const toObserverYaw = (sh3dYaw: number) => normalize(sh3dYaw + Math.PI / 2)
export const fromObserverYaw = (yaw: number) => normalize(yaw - Math.PI / 2)
export const toObserverPitch = (sh3dPitch: number) => -sh3dPitch
export const fromObserverPitch = (pitch: number) => -pitch
