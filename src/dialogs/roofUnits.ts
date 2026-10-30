/** Winkel im Dachdialog: Grad mit einer Nachkommastelle. */
export const toDegrees = (rad: number) => Math.round((rad * 1800) / Math.PI) / 10
export const toRadians = (deg: number) => (deg * Math.PI) / 180
