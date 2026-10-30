import { strFromU8, unzip, type Unzipped } from 'fflate'
import type { CatalogPiece, TexturesCatalog } from '../api/catalog'
import { parseArgb } from '../model/colors'
import { CONTENT_PREFIX, guessMime } from '../model/contents'
import {
  compassBesideHome,
  createEmptyHome,
  DEFAULT_LABEL_FONT_SIZE,
  type DoorOrWindowInfo,
  type Home,
  type HomePiece,
  type Level,
  type Roof,
  type LibraryInfo,
  type LightInfo,
  type Room,
  type Surface,
  type TextureMaps,
  type TextureRef,
  type Wall,
} from '../model/home'
import { DEFAULT_FLOOR_THICKNESS, levelElevation, sortLevels } from '../model/levels'
import { toObserverPitch, toObserverYaw } from './sh3dCamera'
import { LIBRARIES_PROPERTY, LIBRARY_ID_PROPERTY, ROOF_ID_PROPERTY, ROOF_LEVEL_PROPERTY, ROOF_PROPERTY, TEXTURE_EXTRAS_PROPERTY, TO_ROOF_PROPERTY, type TextureExtras } from './sh3dExport'

export interface ImportResult {
  home: Home
  /** Importierte Modelle und Symbole für IndexedDB, Schlüssel wie in „content:<Schlüssel>“. */
  contents: Record<string, Blob>
  /** Hinweis für den Nutzer: Möbel ohne ladbares Modell. */
  missingModels: number
}

/** Wert eines property-Elements (Sweet Home 3D ab 5.3: name/value) direkt unter {@code parent}. */
function property(parent: Element, name: string): string | null {
  return [...parent.children].find((e) => e.nodeName === 'property' && e.getAttribute('name') === name)?.getAttribute('value') ?? null
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export class Sh3dImportError extends Error {
  readonly reason: 'notZip' | 'noXml'

  constructor(reason: 'notZip' | 'noXml') {
    super(reason)
    this.reason = reason
  }
}

// Regale (shelfUnit) werden wie normale Möbel übernommen, ohne ihre Fächer
const FURNITURE_ELEMENTS = new Set(['pieceOfFurniture', 'doorOrWindow', 'light', 'shelfUnit'])

/**
 * Liest eine .sh3d-Datei über ihren Eintrag Home.xml (Sweet Home 3D ab 5.3). Möbel aus dem
 * Standardkatalog verweisen auf dessen Modelle; alle anderen Modelle und Symbole werden als
 * Blobs übernommen.
 */
export async function importSh3d(data: Uint8Array, catalog: CatalogPiece[], textures: TexturesCatalog | null = null): Promise<ImportResult> {
  let files: Unzipped
  try {
    // Entpackt in Hintergrund-Threads, damit große Dateien die Oberfläche nicht blockieren
    files = await new Promise<Unzipped>((resolve, reject) => unzip(data, (error, result) => (error ? reject(error) : resolve(result))))
  } catch {
    throw new Sh3dImportError('notZip')
  }
  if (!files['Home.xml']) throw new Sh3dImportError('noXml')
  const doc = new DOMParser().parseFromString(strFromU8(files['Home.xml']), 'application/xml')
  const root = doc.documentElement
  if (root.nodeName !== 'home') throw new Sh3dImportError('noXml')

  const byCatalogId = new Map(catalog.map((p) => [p.id, p]))
  const home = createEmptyHome()
  const contents: Record<string, Blob> = {}
  const toBlob = (bytes: Uint8Array, name: string) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: guessMime(bytes, name) })
  home.wallHeight = num(root, 'wallHeight') ?? home.wallHeight

  // Ebenen in der Reihenfolge von Sweet Home 3D: nach Höhe, dann elevationIndex
  const levelElements = [...root.children]
    .filter((e) => e.nodeName === 'level')
    .sort((a, b) => (num(a, 'elevation') ?? 0) - (num(b, 'elevation') ?? 0) || (num(a, 'elevationIndex') ?? 0) - (num(b, 'elevationIndex') ?? 0))
  home.levels = sortLevels(
    levelElements.map((e, index): Level => ({
      id: e.getAttribute('id') ?? `level-${index}`,
      name: e.getAttribute('name') ?? String(index),
      elevation: num(e, 'elevation') ?? 0,
      floorThickness: num(e, 'floorThickness') ?? DEFAULT_FLOOR_THICKNESS,
      height: num(e, 'height') ?? home.wallHeight,
      // „visible“ leitet Sweet Home 3D aus der gewählten Ebene ab; nur „viewable“ stellt der Nutzer ein
      viewable: e.getAttribute('viewable') !== 'false',
      ...(property(e, ROOF_LEVEL_PROPERTY) === 'true' && { roof: true }),
    })),
  )
  const levelIds = new Set(home.levels.map((l) => l.id))
  const lowest = home.levels[0]?.id ?? null
  /** Ebene eines Elements; ohne gültige Angabe die unterste. */
  const levelOf = (e: Element) => {
    const id = e.getAttribute('level')
    return id && levelIds.has(id) ? id : lowest
  }
  const selected = root.getAttribute('selectedLevel')
  home.selectedLevel = selected && levelIds.has(selected) ? selected : lowest

  const imported = new Map<string, string | null>()
  /** Übernimmt einen Inhalt der Datei (einzeln oder als Verzeichnis eines mehrteiligen Modells). */
  const content = (name: string | null): string | null => {
    if (!name) return null
    if (imported.has(name)) return imported.get(name)!
    const id = crypto.randomUUID()
    let ref: string | null = null
    const slash = name.indexOf('/')
    if (slash < 0) {
      if (files[name]) {
        contents[id] = toBlob(files[name], name)
        ref = CONTENT_PREFIX + id
      }
    } else {
      const directory = name.slice(0, slash + 1)
      for (const [entry, bytes] of Object.entries(files)) {
        if (entry.startsWith(directory) && !entry.endsWith('/')) {
          contents[`${id}/${entry.slice(directory.length)}`] = toBlob(bytes, entry)
        }
      }
      if (files[name]) ref = `${CONTENT_PREFIX}${id}/${name.slice(slash + 1)}`
    }
    imported.set(name, ref)
    return ref
  }

  // Bibliotheken, aus denen das Projekt stammt (auch wenn sie hier fehlen), siehe sh3dExport.ts
  const libraries = parseJson<LibraryInfo[]>(property(root, LIBRARIES_PROPERTY))
  if (Array.isArray(libraries) && libraries.length > 0) home.libraries = libraries.filter((l) => l && typeof l.id === 'string')
  const textureExtras = parseJson<TextureExtras>(property(root, TEXTURE_EXTRAS_PROPERTY)) ?? {}

  // Texturen aus dem Katalog (auch importierten Bibliotheken) verweisen auf dessen Bilder, alle anderen werden übernommen
  const catalogTextures = new Map((textures?.categories ?? []).flatMap((c) => c.textures).map((t) => [t.id, t]))
  const textureOf = (parent: Element, attribute: string | null): TextureRef | null => {
    const e = [...parent.children].find((c) => c.nodeName === 'texture' && c.getAttribute('attribute') === attribute)
    if (!e) return null
    const catalogId = e.getAttribute('catalogId')
    const fromCatalog = catalogId ? catalogTextures.get(catalogId) : undefined
    const entry = e.getAttribute('image')
    const image = fromCatalog?.image || content(entry)
    if (!image) return null
    const extras = entry ? textureExtras[entry] : undefined
    let maps: TextureMaps | undefined = fromCatalog?.maps
    if (!fromCatalog && extras?.maps) {
      maps = {}
      for (const [kind, name] of Object.entries(extras.maps) as [keyof TextureMaps, string][]) {
        const ref = content(name)
        if (ref) maps[kind] = ref
      }
    }
    const libraryId = fromCatalog?.libraryId ?? extras?.libraryId
    return {
      catalogId,
      name: e.getAttribute('name') ?? '',
      image,
      width: num(e, 'width') ?? 100,
      height: num(e, 'height') ?? 100,
      ...(maps && Object.keys(maps).length > 0 && { maps }),
      ...(libraryId && { libraryId }),
    }
  }
  const surfaceOf = (e: Element, colorAttribute: string, textureAttribute: string): Surface | undefined => {
    const surface = { color: parseArgb(e.getAttribute(colorAttribute)), texture: textureOf(e, textureAttribute) }
    return surface.color === null && !surface.texture ? undefined : surface
  }

  let missingModels = 0
  const readPiece = (e: Element, level: string | null) => {
    // Von Sweet3D exportiertes Dach: wieder als Dach statt als Möbel
    const roof = parseJson<Roof>(property(e, ROOF_PROPERTY))
    if (roof && Array.isArray(roof.points) && roof.points.length >= 3 && Array.isArray(roof.edges)) {
      home.roofs.push({ ...roof, id: e.getAttribute('id') ?? roof.id, level, holes: roof.holes ?? [] })
      return
    }
    const catalogPiece = byCatalogId.get(e.getAttribute('catalogId') ?? '')
    const libraryId = catalogPiece?.libraryId ?? property(e, LIBRARY_ID_PROPERTY)
    const model = catalogPiece?.model ?? content(e.getAttribute('model'))
    if (!model) missingModels++
    const width = num(e, 'width') ?? 50
    const depth = num(e, 'depth') ?? 50
    const rotation = e.getAttribute('modelRotation')?.trim().split(/\s+/).map(Number)
    const doorOrWindow = e.nodeName === 'doorOrWindow'
    const piece: HomePiece = {
      id: e.getAttribute('id') ?? `piece-${crypto.randomUUID()}`,
      catalogId: e.getAttribute('catalogId'),
      name: e.getAttribute('name') ?? '',
      x: num(e, 'x') ?? 0,
      y: num(e, 'y') ?? 0,
      elevation: num(e, 'elevation') ?? 0,
      angle: num(e, 'angle') ?? 0,
      width,
      depth,
      height: num(e, 'height') ?? 50,
      visible: e.getAttribute('visible') !== 'false',
      model,
      modelRotation: rotation?.length === 9 ? [rotation.slice(0, 3), rotation.slice(3, 6), rotation.slice(6, 9)] : null,
      icon: catalogPiece ? catalogPiece.icon : content(e.getAttribute('icon')),
      planIcon: catalogPiece ? catalogPiece.planIcon : content(e.getAttribute('planIcon')),
      doorOrWindow,
      doorOrWindowInfo: doorOrWindow ? doorInfo(e) : null,
      color: parseArgb(e.getAttribute('color')),
      texture: textureOf(e, null),
      light: e.nodeName === 'light' ? lightInfo(e) : null,
      staircaseCutOutShape: e.getAttribute('staircaseCutOutShape') ?? catalogPiece?.staircaseCutOutShape ?? null,
      ...(libraryId && { libraryId }),
      ...(num(e, 'pitch') && { pitch: num(e, 'pitch')! }),
      ...(property(e, ROOF_ID_PROPERTY) && { roofId: property(e, ROOF_ID_PROPERTY) }),
      level,
    }
    home.furniture.push(piece)
  }

  const readFurniture = (parent: Element, groupLevel: string | null) => {
    for (const e of parent.children) {
      const level = groupLevel ?? levelOf(e)
      // Gruppen auflösen: Sweet Home 3D speichert die enthaltenen Möbel mit absoluten Koordinaten
      if (e.nodeName === 'furnitureGroup') readFurniture(e, level)
      else if (FURNITURE_ELEMENTS.has(e.nodeName)) readPiece(e, level)
    }
  }
  readFurniture(root, null)

  const walls = [...root.children].filter((e) => e.nodeName === 'wall')
  const wallIds = new Set(walls.map((e) => e.getAttribute('id')))
  home.walls = walls.map((e): Wall => {
    const joined = (attribute: string) => {
      const id = e.getAttribute(attribute)
      return id && wallIds.has(id) ? id : null
    }
    const height = num(e, 'height')
    return {
      id: e.getAttribute('id') ?? `wall-${crypto.randomUUID()}`,
      xStart: num(e, 'xStart') ?? 0,
      yStart: num(e, 'yStart') ?? 0,
      xEnd: num(e, 'xEnd') ?? 0,
      yEnd: num(e, 'yEnd') ?? 0,
      wallAtStart: joined('wallAtStart'),
      wallAtEnd: joined('wallAtEnd'),
      thickness: num(e, 'thickness') ?? 10,
      height: height && height > 0 ? height : null,
      level: levelOf(e),
      leftSide: surfaceOf(e, 'leftSideColor', 'leftSideTexture'),
      rightSide: surfaceOf(e, 'rightSideColor', 'rightSideTexture'),
      ...(property(e, TO_ROOF_PROPERTY) === 'true' && { toRoof: true }),
    }
  })

  home.rooms = [...root.children]
    .filter((e) => e.nodeName === 'room')
    .map((e): Room => ({
      id: e.getAttribute('id') ?? `room-${crypto.randomUUID()}`,
      name: e.getAttribute('name'),
      points: [...e.children].filter((p) => p.nodeName === 'point').map((p) => [num(p, 'x') ?? 0, num(p, 'y') ?? 0]),
      floorVisible: e.getAttribute('floorVisible') !== 'false',
      ceilingVisible: e.getAttribute('ceilingVisible') !== 'false',
      level: levelOf(e),
      floor: surfaceOf(e, 'floorColor', 'floorTexture'),
      ceiling: surfaceOf(e, 'ceilingColor', 'ceilingTexture'),
    }))
    .filter((room) => room.points.length >= 3)

  const children = (name: string) => [...root.children].filter((e) => e.nodeName === name)
  home.dimensionLines = children('dimensionLine').map((e) => ({
    id: e.getAttribute('id') ?? `dimensionLine-${crypto.randomUUID()}`,
    xStart: num(e, 'xStart') ?? 0,
    yStart: num(e, 'yStart') ?? 0,
    xEnd: num(e, 'xEnd') ?? 0,
    yEnd: num(e, 'yEnd') ?? 0,
    offset: num(e, 'offset') ?? 0,
    level: levelOf(e),
  }))
  home.labels = children('label')
    .map((e) => {
      const style = [...e.children].find((c) => c.nodeName === 'textStyle' && !c.getAttribute('attribute'))
      return {
        id: e.getAttribute('id') ?? `label-${crypto.randomUUID()}`,
        text: [...e.children].find((c) => c.nodeName === 'text')?.textContent ?? '',
        x: num(e, 'x') ?? 0,
        y: num(e, 'y') ?? 0,
        angle: num(e, 'angle') ?? 0,
        fontSize: (style && num(style, 'fontSize')) ?? DEFAULT_LABEL_FONT_SIZE,
        color: parseArgb(e.getAttribute('color')),
        level: levelOf(e),
      }
    })
    .filter((label) => label.text.trim() !== '')

  const observer = [...root.children].find((e) => e.nodeName === 'observerCamera' && e.getAttribute('attribute') === 'observerCamera')
  if (observer) {
    home.camera.observer = {
      x: num(observer, 'x') ?? home.camera.observer.x,
      y: num(observer, 'y') ?? home.camera.observer.y,
      // Sweet Home 3D speichert die Augenhöhe über dem Gelände, Sweet3D über der gewählten Ebene
      z: Math.max(20, (num(observer, 'z') ?? home.camera.observer.z) - levelElevation(home, home.selectedLevel)),
      yaw: toObserverYaw(num(observer, 'yaw') ?? 0),
      pitch: toObserverPitch(num(observer, 'pitch') ?? 0),
      fieldOfView: num(observer, 'fieldOfView') ?? home.camera.observer.fieldOfView,
    }
  }
  home.camera.mode = root.getAttribute('camera') === 'observerCamera' ? 'observer' : 'aerial'
  // Uhrzeit für den Sonnenstand von der aktiven Kamera, sonst von irgendeiner
  const cameras = [...root.children].filter((e) => e.nodeName === 'observerCamera' || e.nodeName === 'camera')
  const activeCamera = cameras.find((e) => e.getAttribute('attribute') === (home.camera.mode === 'observer' ? 'observerCamera' : 'topCamera'))
  home.camera.time = [activeCamera, ...cameras].map((e) => e && num(e, 'time')).find((time) => time != null) ?? home.camera.time

  const compass = [...root.children].find((e) => e.nodeName === 'compass')
  if (!compass) Object.assign(home.compass, compassBesideHome(home, home.compass.diameter))
  if (compass) {
    const defaults = home.compass
    home.compass = {
      x: num(compass, 'x') ?? defaults.x,
      y: num(compass, 'y') ?? defaults.y,
      diameter: num(compass, 'diameter') ?? defaults.diameter,
      northDirection: num(compass, 'northDirection') ?? defaults.northDirection,
      latitude: num(compass, 'latitude') ?? defaults.latitude,
      longitude: num(compass, 'longitude') ?? defaults.longitude,
      timeZone: compass.getAttribute('timeZone') ?? defaults.timeZone,
      visible: compass.getAttribute('visible') !== 'false',
    }
  }

  return { home, contents, missingModels }
}

function doorInfo(e: Element): DoorOrWindowInfo {
  return {
    wallThickness: num(e, 'wallThickness') ?? 1,
    wallDistance: num(e, 'wallDistance') ?? 0,
    widthDepthDeformable: e.getAttribute('widthDepthDeformable') !== 'false',
    sashes: [...e.children]
      .filter((s) => s.nodeName === 'sash')
      .map((s) => ({
        xAxis: num(s, 'xAxis') ?? 0,
        yAxis: num(s, 'yAxis') ?? 0,
        width: num(s, 'width') ?? 0,
        startAngle: num(s, 'startAngle') ?? 0,
        endAngle: num(s, 'endAngle') ?? 0,
      })),
  }
}

function lightInfo(e: Element): LightInfo {
  return {
    power: num(e, 'power') ?? 0.5,
    sources: [...e.children]
      .filter((s) => s.nodeName === 'lightSource')
      .map((s) => ({
        x: num(s, 'x') ?? 0.5,
        y: num(s, 'y') ?? 0.5,
        z: num(s, 'z') ?? 0.5,
        color: (parseArgb(s.getAttribute('color')?.replace('#', '') ?? null) ?? 0xffffff) & 0xffffff,
        diameter: num(s, 'diameter') ?? 0,
      })),
  }
}

function num(e: Element, attribute: string): number | null {
  const value = e.getAttribute(attribute)
  if (value === null) return null
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

/** Projektname aus dem Dateinamen, z. B. „Haus.sh3d“ → „Haus“. */
export function projectNameFromFile(fileName: string): string {
  return fileName.replace(/\.sh3d$/i, '').trim()
}
