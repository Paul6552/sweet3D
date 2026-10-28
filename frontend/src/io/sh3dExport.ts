import { strToU8, zipSync } from 'fflate'
import { catalogApi, type CatalogPiece } from '../api/catalog'
import { CONTENT_PREFIX, dataUrlToBytes, isContentRef } from '../model/contents'
import type { Home, HomePiece } from '../model/home'
import { fromObserverPitch, fromObserverYaw } from './sh3dCamera'

/** Modell für Möbel ohne ladbares Modell, damit Sweet Home 3D die Datei öffnen kann. */
const FALLBACK_MODEL = '/catalog/resources/texturableBox/texturableBox.obj'

/**
 * Schreibt ein Projekt als .sh3d-Datei, wie sie Sweet Home 3D ab Version 5.3 liest: ZIP mit
 * Home.xml und den Modellen und Symbolen als nummerierte Einträge („0“, „1“, … bzw. „2/datei.obj“
 * bei mehrteiligen Modellen). Den serialisierten Java-Eintrag „Home“ braucht die Desktop-App nicht.
 */
export async function exportSh3d(home: Home, catalog: CatalogPiece[]): Promise<Blob> {
  const modelParts = await catalogApi.modelParts()
  const byId = new Map(catalog.map((p) => [p.id, p]))
  const entries: Record<string, Uint8Array> = {}
  const written = new Map<string, Promise<string | null>>()
  let next = 0

  const fetchBytes = async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  /** Legt den Inhalt hinter einem Verweis einmalig im ZIP ab und liefert den Namen für Home.xml. */
  const content = (ref: string | null): Promise<string | null> => {
    if (!ref) return Promise.resolve(null)
    let name = written.get(ref)
    if (!name) {
      name = (async () => {
        if (isContentRef(ref)) {
          const key = ref.slice(CONTENT_PREFIX.length)
          const slash = key.indexOf('/')
          if (slash < 0) {
            if (!home.contents[key]) return null
            const entry = String(next++)
            entries[entry] = dataUrlToBytes(home.contents[key])
            return entry
          }
          const directory = `${next++}/`
          const prefix = key.slice(0, slash + 1)
          for (const [k, url] of Object.entries(home.contents)) {
            if (k.startsWith(prefix)) entries[directory + k.slice(prefix.length)] = dataUrlToBytes(url)
          }
          return directory + key.slice(slash + 1)
        }
        const base = ref.slice(0, ref.lastIndexOf('/') + 1)
        const parts = modelParts[base]
        if (!parts) {
          const entry = String(next++)
          entries[entry] = await fetchBytes(ref)
          return entry
        }
        const directory = `${next++}/`
        await Promise.all(parts.map(async (part) => (entries[directory + part] = await fetchBytes(base + part))))
        return directory + ref.slice(base.length)
      })()
      written.set(ref, name)
    }
    return name
  }

  const pieces = await Promise.all(home.furniture.map((piece) => pieceXml(piece, byId.get(piece.catalogId ?? ''), content)))
  const { observer } = home.camera
  const xml = [
    "<?xml version='1.0'?>",
    `<home version='7400' camera='${home.camera.mode === 'observer' ? 'observerCamera' : 'topCamera'}' wallHeight='${home.wallHeight}'>`,
    ...['NAME', 'WIDTH', 'DEPTH', 'HEIGHT', 'VISIBLE'].map((name) => `  <furnitureVisibleProperty name='${name}'/>`),
    `  ${element('observerCamera', {
      attribute: 'observerCamera',
      lens: 'PINHOLE',
      x: observer.x,
      y: observer.y,
      z: observer.z,
      yaw: fromObserverYaw(observer.yaw),
      pitch: fromObserverPitch(observer.pitch),
      fieldOfView: observer.fieldOfView,
    })}`,
    // Standard-Luftansicht von Sweet Home 3D; die Desktop-App richtet sie beim Öffnen selbst aus
    `  ${element('camera', { attribute: 'topCamera', lens: 'PINHOLE', x: 50, y: 1050, z: 1010, yaw: Math.PI, pitch: Math.PI / 4, fieldOfView: (63 * Math.PI) / 180 })}`,
    ...pieces.map((p) => `  ${p}`),
    ...home.walls.map(
      (wall) =>
        `  ${element('wall', {
          id: wall.id,
          wallAtStart: wall.wallAtStart,
          wallAtEnd: wall.wallAtEnd,
          xStart: wall.xStart,
          yStart: wall.yStart,
          xEnd: wall.xEnd,
          yEnd: wall.yEnd,
          height: wall.height,
          thickness: wall.thickness,
          pattern: 'hatchUp',
        })}`,
    ),
    ...home.rooms.map((room) => {
      const attributes = element('room', {
        id: room.id,
        name: room.name,
        areaVisible: true,
        floorVisible: room.floorVisible ? null : false,
        ceilingVisible: room.ceilingVisible ? null : false,
      }, true)
      const points = room.points.map(([x, y]) => `    ${element('point', { x, y })}`)
      return [`  ${attributes}`, ...points, '  </room>'].join('\n')
    }),
    '</home>',
    '',
  ].join('\n')

  return new Blob([zipSync({ 'Home.xml': strToU8(xml), ...entries }) as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })
}

async function pieceXml(piece: HomePiece, catalogPiece: CatalogPiece | undefined, content: (ref: string | null) => Promise<string | null>): Promise<string> {
  const [model, icon, planIcon] = await Promise.all([
    content(piece.model).then((m) => m ?? content(FALLBACK_MODEL)),
    content(piece.icon),
    content(piece.planIcon),
  ])
  const door = piece.doorOrWindow ? piece.doorOrWindowInfo : null
  const catalogDoor = catalogPiece?.doorOrWindow
  const attributes = {
    id: piece.id,
    catalogId: piece.catalogId,
    name: piece.name,
    creator: catalogPiece?.creator ?? null,
    model,
    icon,
    planIcon,
    x: piece.x,
    y: piece.y,
    elevation: piece.elevation,
    angle: piece.angle,
    width: piece.width,
    depth: piece.depth,
    height: piece.height,
    modelRotation: piece.modelRotation ? piece.modelRotation.flat().join(' ') : null,
    movable: catalogPiece ? catalogPiece.movable : null,
    visible: piece.visible ? null : false,
    color: piece.color === null ? null : (piece.color >>> 0).toString(16).toUpperCase().padStart(8, '0'),
    ...(door && {
      wallThickness: door.wallThickness,
      wallDistance: door.wallDistance,
      cutOutShape: catalogDoor?.cutOutShape ?? null,
      wallCutOutOnBothSides: catalogDoor?.wallCutOutOnBothSides ?? null,
      widthDepthDeformable: door.widthDepthDeformable ? null : false,
    }),
  }
  if (!door) return element('pieceOfFurniture', attributes)
  const sashes = door.sashes.map((sash) => `    ${element('sash', { ...sash })}`)
  return [element('doorOrWindow', attributes, sashes.length > 0), ...(sashes.length ? [...sashes, '  </doorOrWindow>'] : [])].join('\n')
}

type AttributeValue = string | number | boolean | null | undefined

/** XML-Element mit Attributen; {@code null}/{@code undefined} werden weggelassen. */
function element(name: string, attributes: Record<string, AttributeValue>, open = false): string {
  const text = Object.entries(attributes)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null && entry[1] !== undefined)
    .map(([key, value]) => ` ${key}='${escapeXml(String(value))}'`)
    .join('')
  return `<${name}${text}${open ? '>' : '/>'}`
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}
