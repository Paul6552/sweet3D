/** Farben wie in Sweet Home 3D als ARGB-Zahl (z. B. 0xFF9999A0); Umrechnung für CSS und Eingabefelder. */

export function argbToCss(argb: number): string {
  return `#${((argb >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`
}

/** „#rrggbb“ → undurchsichtige ARGB-Zahl. */
export function cssToArgb(css: string): number {
  return (0xff000000 | Number.parseInt(css.slice(1, 7), 16)) | 0
}

/** Hex-Text aus Home.xml („FF9999A0“) bzw. für Home.xml. */
export function parseArgb(text: string | null): number | null {
  if (!text) return null
  const value = Number.parseInt(text, 16)
  return Number.isFinite(value) ? value | 0 : null
}

export function formatArgb(argb: number): string {
  return (argb >>> 0).toString(16).toUpperCase().padStart(8, '0')
}
