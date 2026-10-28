/**
 * Importierte Inhalte (Modelle, Symbole), die nicht im Katalog sind, liegen als Blobs in IndexedDB
 * (siehe storage/contents.ts). Ein Möbel verweist darauf mit „content:<Schlüssel>“. Mehrteilige
 * Modelle (OBJ mit MTL und Texturen) haben Schlüssel der Form „<id>/<Datei>“, damit relative
 * Verweise in der MTL-Datei auflösbar bleiben; einteilige nur „<id>“.
 */
export const CONTENT_PREFIX = 'content:'

export function isContentRef(ref: string): boolean {
  return ref.startsWith(CONTENT_PREFIX)
}

/** Schlüssel in IndexedDB, z. B. „<id>/sessel.obj“. */
export function contentKey(ref: string): string {
  return ref.slice(CONTENT_PREFIX.length)
}

/** Id des importierten Inhalts ohne Dateinamen. */
export function contentId(ref: string): string {
  return contentKey(ref).split('/')[0]
}

/** Nur für die Übernahme alter Projekte, die Inhalte als Data-URLs gespeichert hatten. */
export function dataUrlToBytes(url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** MIME-Typ anhand der ersten Bytes bzw. der Dateiendung. */
export function guessMime(bytes: Uint8Array, name: string): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  if (/\.(obj|mtl)$/i.test(name)) return 'text/plain'
  return 'application/octet-stream'
}
