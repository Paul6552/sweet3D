// Liest Möbel- und Texturkataloge im Format von Sweet Home 3D (.properties wie in
// DefaultFurnitureCatalog bzw. PluginFurnitureCatalog). Wird im Browser (Import von .sh3f/.sh3t)
// und von scripts/build-catalog.mjs (Standardkatalog) verwendet, daher ohne Browser-Abhängigkeiten.
//
// Die Umrechnungen entsprechen com.eteks.sweethome3d.io.DefaultFurnitureCatalog bzw.
// DefaultTexturesCatalog: Flügel und Wandlage relativ zu Breite/Tiefe, Winkel in Radiant.

import type { CatalogPiece, CatalogTexture } from '../api/catalog'
import type { LightInfo } from '../model/home'

export type Properties = Map<string, string>

/** Liest eine Java-.properties-Datei (ISO-8859-1, Fortsetzungszeilen, \uXXXX-Escapes). */
export function parseProperties(bytes: Uint8Array): Properties {
  const text = new TextDecoder('latin1').decode(bytes)
  const result: Properties = new Map()
  const lines = text.split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^[ \t\f]+/, '')
    if (!line || line[0] === '#' || line[0] === '!') continue
    // Eine ungerade Anzahl Backslashes am Zeilenende setzt die Zeile fort
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i].replace(/^[ \t\f]+/, '')
    }
    const match = /^((?:\\.|[^=:\s\\])*)\s*[=:\s]?\s*(.*)$/s.exec(line)
    if (match) result.set(unescape(match[1]), unescape(match[2]))
  }
  return result
}

function unescape(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) => {
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16))
    return ({ t: '\t', n: '\n', r: '\r', f: '\f' } as Record<string, string>)[c] ?? c
  })
}

/** Basis- und Sprachdatei wie ein ResourceBundle (Sprache überschreibt Basis). */
export function mergeBundles(base: Properties, localized: Properties | undefined): Properties {
  const merged = new Map(base)
  if (localized) for (const [key, value] of localized) merged.set(key, value)
  return merged
}

/** Bildet einen Pfad aus der .properties-Datei auf eine URL bzw. einen Inhaltsverweis ab. */
export type ResolvePath = (path: string | undefined) => string | null

const float = (value: string) => Number.parseFloat(value)
const floats = (value: string) => value.trim().split(/\s+/).map(float)
const radians = (degrees: number) => (degrees * Math.PI) / 180

/**
 * Sortiert wie FurnitureCatalog/TexturesCatalog: java.text.Collator ignoriert Leerzeichen und
 * Bindestriche, aber z. B. keine Apostrophe. Bei gleichem Namen fügt Sweet Home 3D per Binärsuche vor dem vorhandenen
 * Eintrag ein, der spätere Eintrag steht also vorn.
 */
export function sortedCategories<T extends { name: string }>(categories: Map<string, T[]>, language: string): { name: string; items: T[] }[] {
  const intl = new Intl.Collator(language)
  const strip = (name: string) => name.replace(/[\s-]/g, '')
  const compare = (a: string, b: string) => intl.compare(strip(a), strip(b))
  const byName = (items: T[]) =>
    items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => compare(a.item.name, b.item.name) || b.index - a.index)
      .map(({ item }) => item)
  return [...categories.entries()].sort(([a], [b]) => compare(a, b)).map(([name, items]) => ({ name, items: byName(items) }))
}

export interface FurnitureEntry {
  category: string
  piece: CatalogPiece
  /** Pfad des Modells in der Bibliothek und ob alle Dateien seines Verzeichnisses dazugehören. */
  modelPath: string | null
  multiPartModel: boolean
}

/** Möbel einer .properties-Datei mit „#1“, „#2“, … je Eintrag. */
export function readFurnitureEntries(props: Properties, resolve: ResolvePath, libraryId: string | null = null): FurnitureEntry[] {
  const get = (key: string, i: number) => props.get(`${key}#${i}`)
  const bool = (key: string, i: number, fallback: boolean) => (get(key, i) === undefined ? fallback : get(key, i) === 'true')
  const number = (key: string, i: number, fallback: number) => {
    const value = get(key, i)
    const n = value === undefined ? NaN : float(value)
    return Number.isFinite(n) ? n : fallback
  }
  const entries: FurnitureEntry[] = []
  for (let i = 1; get('id', i) !== undefined || get('name', i) !== undefined; i++) {
    const width = number('width', i, 50)
    const depth = number('depth', i, 50)
    const height = number('height', i, 50)
    const doorOrWindow = get('doorOrWindow', i) === 'true'
    const rotation = get('modelRotation', i) ? floats(get('modelRotation', i)!) : [1, 0, 0, 0, 1, 0, 0, 0, 1]
    let doorInfo: CatalogPiece['doorOrWindow'] = null
    if (doorOrWindow) {
      const list = (key: string) => (get(key, i) ? floats(get(key, i)!) : [])
      const yAxis = list('doorOrWindowSashYAxis')
      const widths = list('doorOrWindowSashWidth')
      const starts = list('doorOrWindowSashStartAngle')
      const ends = list('doorOrWindowSashEndAngle')
      doorInfo = {
        wallThickness: number('doorOrWindowWallThickness', i, depth) / depth,
        wallDistance: number('doorOrWindowWallDistance', i, 0) / depth,
        wallCutOutOnBothSides: bool('doorOrWindowWallCutOutOnBothSides', i, true),
        widthDepthDeformable: bool('doorOrWindowWidthDepthDeformable', i, true),
        cutOutShape: get('doorOrWindowCutOutShape', i) ?? null,
        sashes: list('doorOrWindowSashXAxis').map((x, s) => ({
          xAxis: x / width,
          yAxis: yAxis[s] / depth,
          width: widths[s] / width,
          startAngle: radians(starts[s]),
          endAngle: radians(ends[s]),
        })),
      }
    }
    // Leuchten: Farben als #RRGGBB
    let light: LightInfo | null = null
    if (get('lightSourceX', i)) {
      const list = (key: string) => (get(key, i) ? get(key, i)!.trim().split(/\s+/) : [])
      const ys = list('lightSourceY')
      const zs = list('lightSourceZ')
      const colors = list('lightSourceColor')
      const diameters = list('lightSourceDiameter')
      light = {
        power: number('lightPower', i, 0.5),
        // Im Katalog in cm, im Projekt wie in Sweet Home 3D relativ zu Breite, Tiefe und Höhe
        sources: list('lightSourceX').map((x, s) => ({
          x: float(x) / width,
          y: float(ys[s]) / depth,
          z: float(zs[s]) / height,
          color: colors[s] ? Number.parseInt(colors[s].replace('#', ''), 16) : 0xffffff,
          diameter: diameters[s] ? float(diameters[s]) / width : 0,
        })),
      }
    }
    const piece: CatalogPiece = {
      id: get('id', i) ?? `${libraryId ?? 'catalog'}#${i}`,
      name: get('name', i) ?? '',
      description: get('description', i) ?? null,
      creator: get('creator', i) ?? null,
      tags: get('tags', i) ? get('tags', i)!.split(/\s*,\s*/) : [],
      icon: resolve(get('icon', i)),
      planIcon: resolve(get('planIcon', i)),
      model: resolve(get('model', i)),
      modelRotation: [rotation.slice(0, 3), rotation.slice(3, 6), rotation.slice(6, 9)],
      width,
      depth,
      height,
      elevation: number('elevation', i, 0),
      dropOnTopElevation: get('dropOnTopElevation', i) ? number('dropOnTopElevation', i, height) / height : 1,
      movable: get('movable', i) === 'true',
      resizable: bool('resizable', i, true),
      deformable: bool('deformable', i, true),
      texturable: bool('texturable', i, true),
      // Türen und Fenster lassen sich in Sweet Home 3D nie horizontal kippen
      horizontallyRotatable: !doorOrWindow && bool('horizontallyRotatable', i, true),
      backFaceShown: bool('backFaceShown', i, false),
      color: get('color', i) ? Number.parseInt(get('color', i)!) : null,
      staircaseCutOutShape: get('staircaseCutOutShape', i) ?? null,
      doorOrWindow: doorInfo,
      light,
      ...(libraryId && { libraryId }),
    }
    entries.push({ category: get('category', i) ?? '', piece, modelPath: get('model', i) ?? null, multiPartModel: get('multiPartModel', i) === 'true' })
  }
  return entries
}

export interface TextureEntry {
  category: string
  texture: CatalogTexture
}

export function readTextureEntries(props: Properties, resolve: ResolvePath, libraryId: string | null = null): TextureEntry[] {
  const entries: TextureEntry[] = []
  for (let i = 1; props.has(`id#${i}`) || props.has(`name#${i}`); i++) {
    const image = resolve(props.get(`image#${i}`))
    if (!image) continue
    entries.push({
      category: props.get(`category#${i}`) ?? '',
      texture: {
        id: props.get(`id#${i}`) ?? `${libraryId ?? 'textures'}#${i}`,
        name: props.get(`name#${i}`) ?? '',
        creator: props.get(`creator#${i}`) ?? null,
        image,
        icon: image,
        width: float(props.get(`width#${i}`) ?? '100') || 100,
        height: float(props.get(`height#${i}`) ?? '100') || 100,
        ...(libraryId && { libraryId }),
      },
    })
  }
  return entries
}

/** Gruppiert Einträge nach Kategorie und sortiert wie Sweet Home 3D. */
export function groupByCategory<T extends { name: string }>(entries: { category: string; item: T }[], language: string): { name: string; items: T[] }[] {
  const categories = new Map<string, T[]>()
  for (const { category, item } of entries) {
    if (!categories.has(category)) categories.set(category, [])
    categories.get(category)!.push(item)
  }
  return sortedCategories(categories, language)
}

/** Angaben einer Bibliothek im Kopf der .properties-Datei (ohne „#n“). */
export function libraryHeader(props: Properties) {
  return {
    id: props.get('id') ?? null,
    name: props.get('name') ?? null,
    version: props.get('version') ?? null,
    provider: props.get('provider') ?? null,
    license: props.get('license') ?? null,
    description: props.get('description') ?? null,
  }
}
