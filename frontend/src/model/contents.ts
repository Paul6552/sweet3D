/**
 * Importierte Inhalte (Modelle, Symbole) liegen als Data-URLs in {@link Home.contents}. Ein Möbel
 * verweist darauf mit „content:<Schlüssel>“. Mehrteilige Modelle (OBJ mit MTL und Texturen) haben
 * Schlüssel der Form „<id>/<Datei>“, damit relative Verweise in der MTL-Datei auflösbar bleiben.
 */
export const CONTENT_PREFIX = 'content:'

export function isContentRef(ref: string): boolean {
  return ref.startsWith(CONTENT_PREFIX)
}

/** Liefert eine ladbare URL für eine Katalog-URL oder einen Verweis auf importierten Inhalt. */
export function resolveRef(contents: Record<string, string>, ref: string | null): string | null {
  if (!ref) return null
  return isContentRef(ref) ? (contents[ref.slice(CONTENT_PREFIX.length)] ?? null) : ref
}

/** Wandelt Bytes in eine Data-URL um (in Blöcken, damit große Modelle den Stack nicht sprengen). */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

export function dataUrlToBytes(url: string): Uint8Array {
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
