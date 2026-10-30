import { strFromU8, unzip, type Unzipped } from 'fflate'
import type { CatalogPiece, CatalogTexture, FurnitureCatalog, TexturesCatalog } from '../api/catalog'
import { CONTENT_PREFIX, guessMime } from '../model/contents'
import type { Home, LibraryInfo, TextureMaps } from '../model/home'
import { openDatabase } from '../storage/db'
import { removeUnusedContents } from '../storage/projects'
import {
  type FurnitureEntry,
  groupByCategory,
  libraryHeader,
  mergeBundles,
  parseProperties,
  type Properties,
  readFurnitureEntries,
  readTextureEntries,
  type TextureEntry,
} from './sh3fParser'

/**
 * Importierte Bibliothek (Möbel und/oder Texturen), z. B. aus einer .sh3f- bzw. .sh3t-Datei von
 * Sweet Home 3D. Ihre Dateien liegen als Inhalte in IndexedDB; Möbel und Texturen verweisen mit
 * „content:…“ darauf wie importierte Projekte, daher bleiben Projekte auch ohne die Bibliothek lesbar.
 */
export interface StoredLibrary extends LibraryInfo {
  license: string | null
  description: string | null
  importedAt: string
  /** Größe aller Dateien in Bytes. */
  size: number
  /** Kategorien je Sprache; „“ ist die Grundsprache der Bibliothek. */
  furniture: Record<string, FurnitureCatalog['categories']>
  textures: Record<string, TexturesCatalog['categories']>
}

/** Bibliotheken für einzeln importierte Modelle bzw. Bilder. */
export const USER_MODELS = 'sweet3d.user-models'
export const USER_TEXTURES = 'sweet3d.user-textures'

export async function listLibraries(): Promise<StoredLibrary[]> {
  const libraries = await (await openDatabase()).getAll('libraries')
  return libraries.sort((a, b) => a.name.localeCompare(b.name))
}

/** Kategorien einer Bibliothek in der gewünschten Sprache, sonst in ihrer Grundsprache. */
export function localized<T>(byLanguage: Record<string, T[]>, language: string): T[] {
  const base = language.split('-')[0]
  return byLanguage[base] ?? byLanguage[''] ?? Object.values(byLanguage)[0] ?? []
}

/** Löscht eine Bibliothek; Dateien, die Projekte noch verwenden, bleiben erhalten. */
export async function deleteLibrary(id: string) {
  await (await openDatabase()).delete('libraries', id)
  await removeUnusedContents()
}

/** Namen der Projekte, die Möbel oder Texturen aus der Bibliothek verwenden. */
export async function projectsUsingLibrary(id: string): Promise<string[]> {
  const db = await openDatabase()
  const [homes, projects] = await Promise.all([db.getAll('homes'), db.getAll('projects')])
  const keys = await db.getAllKeys('homes')
  const names = new Map(projects.map((p) => [p.id, p.name]))
  return keys.filter((_, i) => usedLibraryIds(homes[i]).has(id)).map((key) => names.get(key) ?? key)
}

/** Ids aller Bibliotheken, aus denen das Projekt Möbel oder Texturen verwendet. */
export function usedLibraryIds(home: Home): Set<string> {
  const ids = new Set<string>()
  const add = (id: string | null | undefined) => id && ids.add(id)
  for (const piece of home.furniture) {
    add(piece.libraryId)
    add(piece.texture?.libraryId)
  }
  for (const wall of home.walls) {
    add(wall.leftSide?.texture?.libraryId)
    add(wall.rightSide?.texture?.libraryId)
  }
  for (const room of home.rooms) {
    add(room.floor?.texture?.libraryId)
    add(room.ceiling?.texture?.libraryId)
  }
  for (const roof of home.roofs ?? []) {
    add(roof.top?.texture?.libraryId)
    add(roof.underside?.texture?.libraryId)
    add(roof.sides?.texture?.libraryId)
  }
  return ids
}

/** Angaben zu den verwendeten Bibliotheken für die Weitergabe des Projekts (siehe Home.libraries). */
export function libraryInfos(home: Home, installed: LibraryInfo[]): LibraryInfo[] {
  const used = usedLibraryIds(home)
  const known = new Map([...(home.libraries ?? []), ...installed].map((l) => [l.id, l]))
  return [...used].map((id) => {
    const info = known.get(id)
    return { id, name: info?.name ?? id, version: info?.version ?? null, provider: info?.provider ?? null, source: info?.source ?? null }
  })
}

export type LibraryImportError = 'unsupported' | 'empty' | 'invalid'

export class LibraryImportFailure extends Error {
  readonly reason: LibraryImportError

  constructor(reason: LibraryImportError) {
    super(reason)
    this.reason = reason
  }
}

export interface LibraryImportResult {
  library: StoredLibrary
  furniture: number
  textures: number
}

const MODEL_EXTENSIONS = /\.(obj|glb|gltf|dae|3ds|kmz)$/i
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp)$/i

/**
 * Importiert eine Datei als Bibliothek: .sh3f/.sh3t (bzw. ein ZIP mit PluginFurnitureCatalog- oder
 * PluginTexturesCatalog.properties), ein ZIP mit Texturbildern (auch PBR-Sätze wie von Poly Haven
 * oder ambientCG), ein einzelnes Modell oder ein Bild.
 */
export async function importLibraryFile(file: File, measure: ModelMeasurer): Promise<LibraryImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (MODEL_EXTENSIONS.test(file.name)) return importModels([{ name: file.name, bytes }], measure)
  if (IMAGE_EXTENSIONS.test(file.name)) return importTextureImages({ [file.name]: bytes })
  let files: Unzipped
  try {
    files = await new Promise<Unzipped>((resolve, reject) => unzip(bytes, (error, result) => (error ? reject(error) : resolve(result))))
  } catch {
    throw new LibraryImportFailure('unsupported')
  }
  const names = Object.keys(files)
  if (names.some((n) => /(^|\/)(Plugin|Default)(Furniture|Textures)Catalog(_[A-Za-z_]+)?\.properties$/.test(n))) {
    return importPluginLibrary(files, file.name)
  }
  const models = names.filter((n) => MODEL_EXTENSIONS.test(n))
  if (models.length > 0) return importModels(models.map((name) => ({ name, bytes: files[name], files })), measure)
  const images = Object.fromEntries(names.filter((n) => IMAGE_EXTENSIONS.test(n)).map((n) => [n, files[n]]))
  if (Object.keys(images).length > 0) return importTextureImages(images)
  throw new LibraryImportFailure('empty')
}

/** Speichert Dateien zusammen mit der Bibliothek in einem Vorgang. */
async function store(library: StoredLibrary, contents: Record<string, Blob>) {
  const db = await openDatabase()
  const tx = db.transaction(['libraries', 'contents'], 'readwrite')
  const contentStore = tx.objectStore('contents')
  await Promise.all([
    ...Object.entries(contents).map(([key, blob]) => contentStore.put(blob, key)),
    tx.objectStore('libraries').put(library),
    tx.done,
  ])
  // Dateien einer früheren Version derselben Bibliothek entfernen, sofern kein Projekt sie verwendet
  await removeUnusedContents()
}

function toBlob(bytes: Uint8Array, name: string): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: guessMime(bytes, name) })
}

/** Bundle-Dateien je Sprache, z. B. „PluginFurnitureCatalog_de.properties“ → „de“. */
function bundles(files: Unzipped, kind: 'Furniture' | 'Textures'): { base: Properties; languages: Map<string, Properties> } | null {
  const pattern = new RegExp(`(^|/)(Plugin|Default)${kind}Catalog(?:_([A-Za-z_]+))?\\.properties$`)
  let base: Properties | null = null
  const languages = new Map<string, Properties>()
  // Dateien im Wurzelverzeichnis zuerst, wie ResourceBundle sie finden würde
  const names = Object.keys(files).sort((a, b) => a.split('/').length - b.split('/').length)
  for (const name of names) {
    const match = pattern.exec(name)
    if (!match) continue
    if (match[3]) {
      const language = match[3].split('_')[0]
      if (!languages.has(language)) languages.set(language, parseProperties(files[name]))
    } else {
      base ??= parseProperties(files[name])
    }
  }
  if (!base && languages.size === 0) return null
  return { base: base ?? new Map(), languages }
}

/** Möbel- bzw. Texturbibliothek im Format von Sweet Home 3D. */
async function importPluginLibrary(files: Unzipped, fileName: string): Promise<LibraryImportResult> {
  const furnitureBundles = bundles(files, 'Furniture')
  const textureBundles = bundles(files, 'Textures')
  const header = libraryHeader(furnitureBundles?.base.size ? furnitureBundles.base : (textureBundles?.base ?? new Map()))
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const id = header.id ?? `file:${baseName}`
  const contents: Record<string, Blob> = {}
  const imported = new Map<string, string | null>()
  let size = 0

  /** Pfade in der Bibliothek, mit oder ohne führenden Schrägstrich bzw. als jar:-URL. */
  const normalize = (path: string) => path.replace(/^jar:.*!\//, '').replace(/^\//, '')
  /** Einzelne Datei (Symbol, Texturbild). */
  const single = (path: string | undefined): string | null => {
    if (!path) return null
    const name = normalize(path)
    if (imported.has(name)) return imported.get(name)!
    let ref: string | null = null
    if (files[name]) {
      const key = crypto.randomUUID()
      contents[key] = toBlob(files[name], name)
      size += files[name].length
      ref = CONTENT_PREFIX + key
    }
    imported.set(name, ref)
    return ref
  }
  const models = new Map<string, string>()
  /**
   * Modell samt Dateien, die es braucht, damit relative Verweise stimmen: bei mehrteiligen Modellen
   * (multiPartModel) das ganze Verzeichnis, sonst die MTL-Datei und ihre Bilder daneben.
   */
  const model = (entry: FurnitureEntry): string | null => {
    if (!entry.modelPath) return null
    const name = normalize(entry.modelPath)
    if (!files[name]) return null
    const slash = name.lastIndexOf('/')
    const directory = slash < 0 ? '' : name.slice(0, slash + 1)
    const group = entry.multiPartModel ? directory : name
    let key = models.get(group)
    if (!key) {
      key = crypto.randomUUID()
      models.set(group, key)
      const members = entry.multiPartModel
        ? Object.keys(files).filter((n) => n.startsWith(directory) && !n.endsWith('/') && !n.endsWith('.properties'))
        : siblings(files, name)
      for (const member of members) {
        contents[`${key}/${member.slice(directory.length)}`] = toBlob(files[member], member)
        size += files[member].length
      }
    }
    return `${CONTENT_PREFIX}${key}/${name.slice(directory.length)}`
  }

  const furniture: StoredLibrary['furniture'] = {}
  let furnitureCount = 0
  if (furnitureBundles) {
    // Modelle und Symbole einmal aus der Grundsprache übernehmen; Übersetzungen ändern nur Texte
    const baseEntries = readFurnitureEntries(furnitureBundles.base, single, id)
    const modelRefs = baseEntries.map(model)
    const withModels = (entries: FurnitureEntry[]) =>
      entries.map((entry, i) => ({ category: entry.category, item: { ...entry.piece, model: modelRefs[i] ?? null } }))
    const categories = (entries: FurnitureEntry[], language: string) =>
      groupByCategory(withModels(entries), language || 'en').map(({ name, items }) => ({ name, pieces: items }))
    furniture[''] = categories(baseEntries, '')
    furnitureCount = baseEntries.length
    for (const [language, props] of furnitureBundles.languages) {
      const entries = readFurnitureEntries(mergeBundles(furnitureBundles.base, props), single, id)
      furniture[language] = categories(entries, language)
    }
  }
  const textures: StoredLibrary['textures'] = {}
  let textureCount = 0
  if (textureBundles) {
    const categories = (entries: TextureEntry[], language: string) =>
      groupByCategory(entries.map((e) => ({ category: e.category, item: e.texture })), language || 'en').map(({ name, items }) => ({ name, textures: items }))
    const baseEntries = readTextureEntries(textureBundles.base, single, id)
    textures[''] = categories(baseEntries, '')
    textureCount = baseEntries.length
    for (const [language, props] of textureBundles.languages) {
      textures[language] = categories(readTextureEntries(mergeBundles(textureBundles.base, props), single, id), language)
    }
  }
  if (furnitureCount + textureCount === 0) throw new LibraryImportFailure('empty')
  const library: StoredLibrary = {
    id,
    name: header.name ?? baseName,
    version: header.version,
    provider: header.provider,
    source: fileName,
    license: header.license,
    description: header.description,
    importedAt: new Date().toISOString(),
    size,
    furniture,
    textures,
  }
  await store(library, contents)
  return { library, furniture: furnitureCount, textures: textureCount }
}

/** Ein einzelnes Modell und, bei OBJ, seine MTL-Datei und deren Bilder (relativ zum Modell). */
function siblings(files: Unzipped, model: string): string[] {
  const result = new Set([model])
  if (!/\.obj$/i.test(model)) return [...result]
  const directory = model.slice(0, model.lastIndexOf('/') + 1)
  const library = /^mtllib\s+(.+)$/m.exec(strFromU8(files[model]))?.[1]?.trim()
  if (library && files[directory + library]) {
    result.add(directory + library)
    for (const match of strFromU8(files[directory + library]).matchAll(/^\s*(?:map_\w+|bump|norm|disp)\s+(.+)$/gim)) {
      const image = match[1].trim().split(/\s+/).pop()
      if (image && files[directory + image]) result.add(directory + image)
    }
  }
  return [...result]
}

/** Misst ein gespeichertes Modell in seinen eigenen Einheiten (siehe view3d/modelLoader.ts). */
export type ModelMeasurer = (ref: string) => Promise<{ width: number; height: number; depth: number; meters: boolean }>

async function existingOrNew(id: string, name: string): Promise<StoredLibrary> {
  const existing = await (await openDatabase()).get('libraries', id)
  return (
    existing ?? {
      id,
      name,
      version: null,
      provider: null,
      source: null,
      license: null,
      description: null,
      importedAt: new Date().toISOString(),
      size: 0,
      furniture: { '': [] },
      textures: { '': [] },
    }
  )
}

/** Hängt Einträge an die Kategorie „Importiert“ einer Bibliothek an (in allen Sprachen). */
function appendTo<T>(byLanguage: Record<string, { name: string }[]>, key: 'pieces' | 'textures', items: T[], category: string) {
  for (const language of Object.keys(byLanguage)) {
    const categories = byLanguage[language] as ({ name: string } & Record<string, T[]>)[]
    let target = categories.find((c) => c.name === category)
    if (!target) {
      target = { name: category, [key]: [] } as { name: string } & Record<string, T[]>
      categories.push(target)
    }
    target[key] = [...target[key], ...items]
  }
}

/**
 * Einzelne Modelle (OBJ, glTF/GLB, DAE, 3DS, KMZ) in die Bibliothek „Eigene Modelle“. Die Maße
 * stammen aus dem Modell; sehr kleine Werte gelten als Meter (glTF immer).
 */
async function importModels(models: { name: string; bytes: Uint8Array; files?: Unzipped }[], measure: ModelMeasurer): Promise<LibraryImportResult> {
  const library = await existingOrNew(USER_MODELS, 'Eigene Modelle')
  const contents: Record<string, Blob> = {}
  const refs: { name: string; ref: string }[] = []
  for (const model of models) {
    const key = crypto.randomUUID()
    const file = model.name.split('/').pop()!
    const members = model.files ? siblings(model.files, model.name) : [model.name]
    const directory = model.name.slice(0, model.name.length - file.length)
    for (const member of members) {
      const bytes = model.files?.[member] ?? model.bytes
      contents[`${key}/${member.slice(directory.length)}`] = toBlob(bytes, member)
      library.size += bytes.length
    }
    refs.push({ name: file.replace(/\.[^.]+$/, ''), ref: `${CONTENT_PREFIX}${key}/${file}` })
  }
  // Erst speichern, dann messen: der Modell-Lader liest die Dateien aus IndexedDB
  await saveOnlyContents(contents)
  const pieces: CatalogPiece[] = []
  for (const { name, ref } of refs) {
    const size = await measure(ref).catch(() => null)
    if (!size) continue
    const scale = size.meters || Math.max(size.width, size.height, size.depth) < 10 ? 100 : 1
    pieces.push({
      id: `${USER_MODELS}:${crypto.randomUUID()}`,
      name,
      description: null,
      creator: null,
      tags: [],
      icon: null,
      planIcon: null,
      model: ref,
      modelRotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      width: Math.max(1, round(size.width * scale)),
      depth: Math.max(1, round(size.depth * scale)),
      height: Math.max(1, round(size.height * scale)),
      elevation: 0,
      dropOnTopElevation: 1,
      movable: true,
      resizable: true,
      deformable: true,
      texturable: true,
      horizontallyRotatable: true,
      backFaceShown: false,
      color: null,
      staircaseCutOutShape: null,
      doorOrWindow: null,
      libraryId: USER_MODELS,
    })
  }
  if (pieces.length === 0) {
    await removeUnusedContents()
    throw new LibraryImportFailure('invalid')
  }
  appendTo(library.furniture, 'pieces', pieces, 'Importiert')
  library.importedAt = new Date().toISOString()
  await store(library, {})
  return { library, furniture: pieces.length, textures: 0 }
}

async function saveOnlyContents(contents: Record<string, Blob>) {
  const db = await openDatabase()
  const tx = db.transaction(['contents', 'libraries'], 'readwrite')
  await Promise.all([...Object.entries(contents).map(([key, blob]) => tx.objectStore('contents').put(blob, key)), tx.done])
}

const round = (value: number) => Math.round(value * 10) / 10

type MapKind = 'color' | keyof TextureMaps | 'arm' | 'ignore'

/**
 * Art eines Bildes in einem PBR-Satz nach dem Dateinamen, z. B. „Wood049_1K-JPG_NormalGL.jpg“
 * (ambientCG) oder „wood_floor_nor_gl_1k.jpg“ (Poly Haven). Ohne Kennung ist es das Farbbild.
 */
export function mapKind(fileName: string): { kind: MapKind; base: string } {
  const name = fileName.split('/').pop()!.replace(/\.[^.]+$/, '')
  const tokens: [MapKind, RegExp][] = [
    ['ignore', /[_\-. ](normaldx|nor_dx|displacement|disp|height|bump|opacity|preview|sphere|cube)$/i],
    ['normal', /[_\-. ](normalgl|nor_gl|normal|nrm|nor|norm)$/i],
    ['roughness', /[_\-. ](roughness|rough|rgh)$/i],
    ['ao', /[_\-. ](ambientocclusion|ambient_occlusion|occlusion|ao)$/i],
    ['metalness', /[_\-. ](metalness|metallic|metal|mtl)$/i],
    ['arm', /[_\-. ](arm|orm)$/i],
    ['color', /[_\-. ](color|colour|col|albedo|basecolor|base_color|diffuse|diff|dif)$/i],
  ]
  // Auflösung und Format am Ende entfernen („_1k“, „_2K-JPG“)
  const stripped = name.replace(/[_\-. ]\d+K-(JPG|PNG)/i, '').replace(/[_\-. ](\d+k)(?=$|[_\-.])/i, '')
  for (const [kind, pattern] of tokens) {
    if (pattern.test(stripped)) return { kind, base: stripped.replace(pattern, '') }
  }
  return { kind: 'color', base: stripped }
}

/** Bilder in die Bibliothek „Eigene Texturen“; Sätze aus Farb-, Normalen-, Rauheitsbild usw. werden zu einer Textur. */
async function importTextureImages(images: Record<string, Uint8Array>): Promise<LibraryImportResult> {
  const library = await existingOrNew(USER_TEXTURES, 'Eigene Texturen')
  const contents: Record<string, Blob> = {}
  const sets = new Map<string, Partial<Record<MapKind, string>>>()
  for (const [name, bytes] of Object.entries(images)) {
    const { kind, base } = mapKind(name)
    if (kind === 'ignore') continue
    const key = crypto.randomUUID()
    contents[key] = toBlob(bytes, name)
    library.size += bytes.length
    const set = sets.get(base) ?? {}
    set[kind] = CONTENT_PREFIX + key
    sets.set(base, set)
  }
  const textures: CatalogTexture[] = []
  for (const [base, set] of sets) {
    const image = set.color
    if (!image) continue
    const maps: TextureMaps = {}
    if (set.normal) maps.normal = set.normal
    // Rot = AO, Grün = Rauheit, Blau = Metall: passt genau zu den Kanälen, die three.js liest
    if (set.arm) Object.assign(maps, { ao: set.arm, roughness: set.arm, metalness: set.arm })
    if (set.roughness) maps.roughness = set.roughness
    if (set.ao) maps.ao = set.ao
    if (set.metalness) maps.metalness = set.metalness
    textures.push({
      id: `${USER_TEXTURES}:${crypto.randomUUID()}`,
      name: base.split('/').pop()!.replace(/[_-]+/g, ' ').trim(),
      creator: null,
      image,
      icon: image,
      width: 100,
      height: 100,
      ...(Object.keys(maps).length > 0 && { maps }),
      libraryId: USER_TEXTURES,
    })
  }
  if (textures.length === 0) throw new LibraryImportFailure('empty')
  appendTo(library.textures, 'textures', textures, 'Importiert')
  library.importedAt = new Date().toISOString()
  await store(library, contents)
  return { library, furniture: 0, textures: textures.length }
}

/** Liest „content:…“-Bibliotheken nur in Sprachen, für die es Einträge gibt. */
export function libraryFurniture(library: StoredLibrary, language: string): FurnitureCatalog['categories'] {
  return localized(library.furniture, language)
}

export function libraryTextures(library: StoredLibrary, language: string): TexturesCatalog['categories'] {
  return localized(library.textures, language)
}
