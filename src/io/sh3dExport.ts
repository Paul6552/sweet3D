import { strToU8, zip } from 'fflate'
import { catalogApi, type CatalogPiece } from '../api/catalog'
import { contentKey, isContentRef } from '../model/contents'
import { contentBlobs } from '../storage/contents'
import type { Home, HomePiece } from '../model/home'
import { defaultWallHeight, levelElevation } from '../model/levels'
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
          const key = contentKey(ref)
          const slash = key.indexOf('/')
          const prefix = key.slice(0, slash + 1)
          const blobs = await contentBlobs(slash < 0 ? key : prefix, slash >= 0)
          if (blobs.length === 0) return null
          const target = slash < 0 ? String(next++) : `${next++}/`
          for (const [k, blob] of blobs) {
            entries[slash < 0 ? target : target + k.slice(prefix.length)] = new Uint8Array(await blob.arrayBuffer())
          }
          return slash < 0 ? target : target + key.slice(slash + 1)
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
    `<home version='7400' camera='${home.camera.mode === 'observer' ? 'observerCamera' : 'topCamera'}'${home.selectedLevel ? ` selectedLevel='${escapeXml(home.selectedLevel)}'` : ''} wallHeight='${home.wallHeight}'>`,
    ...['NAME', 'WIDTH', 'DEPTH', 'HEIGHT', 'VISIBLE'].map((name) => `  <furnitureVisibleProperty name='${name}'/>`),
    `  ${element('observerCamera', {
      attribute: 'observerCamera',
      lens: 'PINHOLE',
      x: observer.x,
      y: observer.y,
      z: observer.z + levelElevation(home, home.selectedLevel),
      yaw: fromObserverYaw(observer.yaw),
      pitch: fromObserverPitch(observer.pitch),
      fieldOfView: observer.fieldOfView,
    })}`,
    // Standard-Luftansicht von Sweet Home 3D; die Desktop-App richtet sie beim Öffnen selbst aus
    `  ${element('camera', { attribute: 'topCamera', lens: 'PINHOLE', x: 50, y: 1050, z: 1010, yaw: Math.PI, pitch: Math.PI / 4, fieldOfView: (63 * Math.PI) / 180 })}`,
    // Ebenen vor allem, was auf sie verweist; elevationIndex ordnet Ebenen gleicher Höhe
    ...home.levels.map(
      (level, index) =>
        `  ${element('level', {
          id: level.id,
          name: level.name,
          elevation: level.elevation,
          floorThickness: level.floorThickness,
          height: level.height,
          elevationIndex: home.levels.filter((l, i) => i < index && l.elevation === level.elevation).length,
          viewable: level.viewable ? null : false,
        })}`,
    ),
    ...pieces.map((p) => `  ${p}`),
    ...home.walls.map(
      (wall) =>
        `  ${element('wall', {
          id: wall.id,
          level: wall.level,
          wallAtStart: wall.wallAtStart,
          wallAtEnd: wall.wallAtEnd,
          xStart: wall.xStart,
          yStart: wall.yStart,
          xEnd: wall.xEnd,
          yEnd: wall.yEnd,
          // Ohne eigene Höhe nimmt Sweet Home 3D die Projekthöhe, nicht die der Ebene
          height: wall.height ?? defaultWallHeight(home, wall.level),
          thickness: wall.thickness,
          pattern: 'hatchUp',
        })}`,
    ),
    ...home.rooms.map((room) => {
      const attributes = element('room', {
        id: room.id,
        level: room.level,
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

  // Packt in Hintergrund-Threads; Bilder und Modelle sind oft schon komprimiert
  const zipped = await new Promise<Uint8Array>((resolve, reject) =>
    zip({ 'Home.xml': strToU8(xml), ...entries }, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data))),
  )
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })
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
    level: piece.level,
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
