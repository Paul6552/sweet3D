import { strFromU8, unzipSync } from 'fflate'
import type { CatalogPiece } from '../api/catalog'
import { bytesToDataUrl, CONTENT_PREFIX, guessMime } from '../model/contents'
import { createEmptyHome, type DoorOrWindowInfo, type Home, type HomePiece, type Room, type Wall } from '../model/home'
import { toObserverPitch, toObserverYaw } from './sh3dCamera'

export interface ImportResult {
  home: Home
  /** Hinweise für den Nutzer: Anzahl übersprungener Ebenen, Möbel ohne ladbares Modell. */
  skippedLevels: number
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
 * Data-URLs in {@link Home.contents} übernommen. Bei mehreren Ebenen wird nur die unterste gelesen.
 */
export function importSh3d(data: Uint8Array, catalog: CatalogPiece[]): ImportResult {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Sh3dImportError('notZip')
  }
  if (!files['Home.xml']) throw new Sh3dImportError('noXml')
  const doc = new DOMParser().parseFromString(strFromU8(files['Home.xml']), 'application/xml')
  const root = doc.documentElement
  if (root.nodeName !== 'home') throw new Sh3dImportError('noXml')

  const byCatalogId = new Map(catalog.map((p) => [p.id, p]))
  const home = createEmptyHome()
  home.wallHeight = num(root, 'wallHeight') ?? home.wallHeight

  // Nur die unterste Ebene; Elemente ohne Ebene gehören zu ihr
  const levels = [...root.children].filter((e) => e.nodeName === 'level')
  const lowest = levels.reduce<Element | null>((best, level) => (!best || (num(level, 'elevation') ?? 0) < (num(best, 'elevation') ?? 0) ? level : best), null)
  const onLevel = (e: Element) => !lowest || !e.getAttribute('level') || e.getAttribute('level') === lowest.getAttribute('id')

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
        home.contents[id] = bytesToDataUrl(files[name], guessMime(files[name], name))
        ref = CONTENT_PREFIX + id
      }
    } else {
      const directory = name.slice(0, slash + 1)
      for (const [entry, bytes] of Object.entries(files)) {
        if (entry.startsWith(directory) && !entry.endsWith('/')) {
          home.contents[`${id}/${entry.slice(directory.length)}`] = bytesToDataUrl(bytes, guessMime(bytes, entry))
        }
      }
      if (files[name]) ref = `${CONTENT_PREFIX}${id}/${name.slice(slash + 1)}`
    }
    imported.set(name, ref)
    return ref
  }

  let missingModels = 0
  const readPiece = (e: Element) => {
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
    }
    home.furniture.push(piece)
  }

  const readFurniture = (parent: Element) => {
    for (const e of parent.children) {
      if (!onLevel(e)) continue
      // Gruppen auflösen: Sweet Home 3D speichert die enthaltenen Möbel mit absoluten Koordinaten
      if (e.nodeName === 'furnitureGroup') readFurniture(e)
      else if (FURNITURE_ELEMENTS.has(e.nodeName)) readPiece(e)
    }
  }
  readFurniture(root)

  const walls = [...root.children].filter((e) => e.nodeName === 'wall' && onLevel(e))
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
    }
  })

  home.rooms = [...root.children]
    .filter((e) => e.nodeName === 'room' && onLevel(e))
    .map((e): Room => ({
      id: e.getAttribute('id') ?? `room-${crypto.randomUUID()}`,
      name: e.getAttribute('name'),
      points: [...e.children].filter((p) => p.nodeName === 'point').map((p) => [num(p, 'x') ?? 0, num(p, 'y') ?? 0]),
      floorVisible: e.getAttribute('floorVisible') !== 'false',
      ceilingVisible: e.getAttribute('ceilingVisible') !== 'false',
    }))
    .filter((room) => room.points.length >= 3)

  const observer = [...root.children].find((e) => e.nodeName === 'observerCamera' && e.getAttribute('attribute') === 'observerCamera')
  if (observer) {
    home.camera.observer = {
      x: num(observer, 'x') ?? home.camera.observer.x,
      y: num(observer, 'y') ?? home.camera.observer.y,
      z: num(observer, 'z') ?? home.camera.observer.z,
      yaw: toObserverYaw(num(observer, 'yaw') ?? 0),
      pitch: toObserverPitch(num(observer, 'pitch') ?? 0),
      fieldOfView: num(observer, 'fieldOfView') ?? home.camera.observer.fieldOfView,
    }
  }
  home.camera.mode = root.getAttribute('camera') === 'observerCamera' ? 'observer' : 'aerial'

  return { home, skippedLevels: Math.max(0, levels.length - 1), missingModels }
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
