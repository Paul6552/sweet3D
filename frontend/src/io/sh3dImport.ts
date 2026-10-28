import { strFromU8, unzip, type Unzipped } from 'fflate'
import type { CatalogPiece } from '../api/catalog'
import { CONTENT_PREFIX, guessMime } from '../model/contents'
import { createEmptyHome, type DoorOrWindowInfo, type Home, type HomePiece, type Level, type Room, type Wall } from '../model/home'
import { DEFAULT_FLOOR_THICKNESS, levelElevation, sortLevels } from '../model/levels'
import { toObserverPitch, toObserverYaw } from './sh3dCamera'

export interface ImportResult {
  home: Home
  /** Importierte Modelle und Symbole für IndexedDB, Schlüssel wie in „content:<Schlüssel>“. */
  contents: Record<string, Blob>
  /** Hinweis für den Nutzer: Möbel ohne ladbares Modell. */
  missingModels: number
}

export class Sh3dImportError extends Error {
  readonly reason: 'notZip' | 'noXml'

  constructor(reason: 'notZip' | 'noXml') {
    super(reason)
    this.reason = reason
  }
}

const FURNITURE_ELEMENTS = new Set(['pieceOfFurniture', 'doorOrWindow', 'light'])

/**
 * Liest eine .sh3d-Datei über ihren Eintrag Home.xml (Sweet Home 3D ab 5.3). Möbel aus dem
 * Standardkatalog verweisen auf dessen Modelle; alle anderen Modelle und Symbole werden als
 * Blobs übernommen.
 */
export async function importSh3d(data: Uint8Array, catalog: CatalogPiece[]): Promise<ImportResult> {
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
      // Ältere Dateien kennen nur „visible“; sichtbar ist eine Ebene, wenn keins von beiden false ist
      viewable: e.getAttribute('viewable') !== 'false' && e.getAttribute('visible') !== 'false',
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

  let missingModels = 0
  const readPiece = (e: Element, level: string | null) => {
    const catalogPiece = byCatalogId.get(e.getAttribute('catalogId') ?? '')
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
      color: e.getAttribute('color') ? Number.parseInt(e.getAttribute('color')!, 16) | 0 : null,
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
    }))
    .filter((room) => room.points.length >= 3)

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
