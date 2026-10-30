import { strToU8, zip } from 'fflate'
import { catalogApi, type CatalogPiece } from '../api/catalog'
import { contentKey, isContentRef } from '../model/contents'
import { contentBlobs } from '../storage/contents'
import { formatArgb } from '../model/colors'
import type { Home, HomePiece, LibraryInfo, Surface, TextureMaps, TextureRef } from '../model/home'
import { defaultWallHeight, levelElevation } from '../model/levels'
import { roofModels } from '../model/roofs'
import { ROOF_COLORS, roofGeometry, roofSurfaces } from '../view3d/roofGeometry'
import { roofObj } from './roofObj'
import { fromObserverPitch, fromObserverYaw } from './sh3dCamera'

/** Modell für Möbel ohne ladbares Modell, damit Sweet Home 3D die Datei öffnen kann. */
const FALLBACK_MODEL = '/catalog/resources/texturableBox/texturableBox.obj'

/** Eigene Angaben von Sweet3D als property-Elemente, die Sweet Home 3D liest und unverändert lässt. */
export const LIBRARIES_PROPERTY = 'sweet3d.libraries'
export const LIBRARY_ID_PROPERTY = 'sweet3d.libraryId'
/** Zu Texturbildern (Eintrag im ZIP) die Einträge ihrer PBR-Karten und ihre Bibliothek. */
export const TEXTURE_EXTRAS_PROPERTY = 'sweet3d.textureExtras'
/** Dach als JSON an seinem Ersatzmöbel; beim Import wird daraus wieder ein Dach. */
export const ROOF_PROPERTY = 'sweet3d.roof'
/** Wand, deren Oberkante dem Dach folgt. */
export const TO_ROOF_PROPERTY = 'sweet3d.toRoof'

export type TextureExtras = Record<string, { maps?: TextureMaps; libraryId?: string }>

/**
 * Schreibt ein Projekt als .sh3d-Datei, wie sie Sweet Home 3D ab Version 5.3 liest: ZIP mit
 * Home.xml und den Modellen und Symbolen als nummerierte Einträge („0“, „1“, … bzw. „2/datei.obj“
 * bei mehrteiligen Modellen). Den serialisierten Java-Eintrag „Home“ braucht die Desktop-App nicht.
 * Modelle aus Bibliotheken werden immer mitgespeichert; {@code libraries} nennt dem Empfänger
 * zusätzlich die Bibliotheken, damit er sie bei Bedarf selbst importieren kann.
 */
export async function exportSh3d(home: Home, catalog: CatalogPiece[], libraries: LibraryInfo[] = []): Promise<Blob> {
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

  /** Inhalt hinter einem Verweis als Bytes, z. B. für Texturen eines erzeugten Modells. */
  const bytesOf = async (ref: string): Promise<Uint8Array | null> => {
    if (!isContentRef(ref)) return fetchBytes(ref)
    const [entry] = await contentBlobs(contentKey(ref), false)
    return entry ? new Uint8Array(await entry[1].arrayBuffer()) : null
  }

  /**
   * Dächer als Möbel mit erzeugtem Modell, damit Sweet Home 3D sie zeigt; die Daten des Dachs stehen
   * in einer Eigenschaft, aus der der Import wieder ein bearbeitbares Dach macht.
   */
  const models = roofModels(home)
  const roofPieces = await Promise.all(
    home.roofs.map(async (roof) => {
      const model = models.get(roof.id)
      const geometry = model && model.surfaces.length > 0 ? roofGeometry(model) : null
      const property = `    ${element('property', { name: ROOF_PROPERTY, value: JSON.stringify(roof) })}`
      const name = roof.name ?? 'Roof'
      const generated = geometry ? roofObj(geometry, roofSurfaces(roof), ROOF_COLORS, name) : null
      geometry?.dispose()
      if (!generated || !Number.isFinite(generated.min[0])) return null
      const directory = `${next++}/`
      entries[`${directory}roof.obj`] = strToU8(generated.obj)
      entries[`${directory}roof.mtl`] = strToU8(generated.mtl)
      await Promise.all(
        [...generated.textures].map(async ([file, texture]) => {
          const bytes = await bytesOf(texture.image).catch(() => null)
          if (bytes) entries[directory + file] = bytes
        }),
      )
      const { min, max } = generated
      const attributes = {
        id: roof.id,
        level: roof.level,
        name,
        creator: 'Sweet3D',
        model: `${directory}roof.obj`,
        x: (min[0] + max[0]) / 2,
        y: (min[2] + max[2]) / 2,
        elevation: min[1],
        width: max[0] - min[0],
        depth: max[2] - min[2],
        height: max[1] - min[1],
        movable: false,
        visible: roof.visible ? null : false,
      }
      return [`  ${openTag('pieceOfFurniture', attributes)}>`, property, '  </pieceOfFurniture>'].join('\n')
    }),
  )

  /** Element „texture“ wie TextureImage in Home.xml; das Bild kommt als Eintrag ins ZIP. */
  const textureExtras: TextureExtras = {}
  const texture = async (ref: TextureRef | null | undefined, attribute: string | null, indent: string): Promise<string[]> => {
    const image = ref ? await content(ref.image).catch(() => null) : null
    if (!ref || !image) return []
    if (ref.maps || ref.libraryId) {
      const maps: TextureMaps = {}
      for (const [kind, map] of Object.entries(ref.maps ?? {}) as [keyof TextureMaps, string][]) {
        const entry = await content(map).catch(() => null)
        if (entry) maps[kind] = entry
      }
      textureExtras[image] = { ...(Object.keys(maps).length > 0 && { maps }), ...(ref.libraryId && { libraryId: ref.libraryId }) }
    }
    return [`${indent}${element('texture', { attribute, name: ref.name, catalogId: ref.catalogId, width: ref.width, height: ref.height, image })}`]
  }
  const color = (surface: Surface | undefined) => (surface?.color != null && !surface.texture ? formatArgb(surface.color) : null)
  /** Element mit Kindern bzw. leer, wenn es keine gibt. */
  const withChildren = (start: string, name: string, children: string[]) =>
    children.length === 0 ? `  ${start}/>` : [`  ${start}>`, ...children, `  </${name}>`].join('\n')

  const pieces = await Promise.all(
    home.furniture.map(async (piece) =>
      pieceXml(piece, byId.get(piece.catalogId ?? ''), content, await texture(piece.texture, null, '    ')),
    ),
  )
  const walls = await Promise.all(
    home.walls.map(async (wall) =>
      withChildren(
        openTag('wall', {
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
          leftSideColor: color(wall.leftSide),
          rightSideColor: color(wall.rightSide),
        }),
        'wall',
        [
          ...(wall.toRoof ? [`    ${element('property', { name: TO_ROOF_PROPERTY, value: 'true' })}`] : []),
          ...(await texture(wall.leftSide?.texture, 'leftSideTexture', '    ')), ...(await texture(wall.rightSide?.texture, 'rightSideTexture', '    ')),
        ],
      ),
    ),
  )
  const rooms = await Promise.all(
    home.rooms.map(async (room) =>
      withChildren(
        openTag('room', {
          id: room.id,
          level: room.level,
          name: room.name,
          areaVisible: true,
          floorVisible: room.floorVisible ? null : false,
          ceilingVisible: room.ceilingVisible ? null : false,
          floorColor: color(room.floor),
          ceilingColor: color(room.ceiling),
        }),
        'room',
        [
          ...room.points.map(([x, y]) => `    ${element('point', { x, y })}`),
          ...(await texture(room.floor?.texture, 'floorTexture', '    ')),
          ...(await texture(room.ceiling?.texture, 'ceilingTexture', '    ')),
        ],
      ),
    ),
  )
  const { observer, time } = home.camera
  const { compass } = home
  const xml = [
    "<?xml version='1.0'?>",
    `<home version='7400' camera='${home.camera.mode === 'observer' ? 'observerCamera' : 'topCamera'}'${home.selectedLevel ? ` selectedLevel='${escapeXml(home.selectedLevel)}'` : ''} wallHeight='${home.wallHeight}'>`,
    // Eigenschaften stehen laut DTD vor allen anderen Kindern
    ...(libraries.length > 0 ? [`  ${element('property', { name: LIBRARIES_PROPERTY, value: JSON.stringify(libraries) })}`] : []),
    ...(Object.keys(textureExtras).length > 0 ? [`  ${element('property', { name: TEXTURE_EXTRAS_PROPERTY, value: JSON.stringify(textureExtras) })}`] : []),
    ...['NAME', 'WIDTH', 'DEPTH', 'HEIGHT', 'VISIBLE'].map((name) => `  <furnitureVisibleProperty name='${name}'/>`),
    `  ${element('compass', {
      x: compass.x,
      y: compass.y,
      diameter: compass.diameter,
      northDirection: compass.northDirection,
      longitude: compass.longitude,
      latitude: compass.latitude,
      timeZone: compass.timeZone,
      visible: compass.visible ? null : false,
    })}`,
    `  ${element('observerCamera', {
      attribute: 'observerCamera',
      lens: 'PINHOLE',
      x: observer.x,
      y: observer.y,
      z: observer.z + levelElevation(home, home.selectedLevel),
      yaw: fromObserverYaw(observer.yaw),
      pitch: fromObserverPitch(observer.pitch),
      fieldOfView: observer.fieldOfView,
      time,
    })}`,
    // Standard-Luftansicht von Sweet Home 3D; die Desktop-App richtet sie beim Öffnen selbst aus
    `  ${element('camera', { attribute: 'topCamera', lens: 'PINHOLE', x: 50, y: 1050, z: 1010, yaw: Math.PI, pitch: Math.PI / 4, fieldOfView: (63 * Math.PI) / 180, time })}`,
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
    ...roofPieces.filter((p) => p !== null),
    ...walls,
    ...rooms,
    ...home.dimensionLines.map(
      (line) =>
        `  ${element('dimensionLine', { id: line.id, level: line.level, xStart: line.xStart, yStart: line.yStart, xEnd: line.xEnd, yEnd: line.yEnd, offset: line.offset })}`,
    ),
    ...home.labels.map((label) =>
      [
        `  ${openTag('label', { id: label.id, level: label.level, x: label.x, y: label.y, angle: label.angle || null, color: label.color === null ? null : formatArgb(label.color) })}>`,
        `    ${element('textStyle', { fontSize: label.fontSize })}`,
        `    <text>${escapeXml(label.text)}</text>`,
        '  </label>',
      ].join('\n'),
    ),
    '</home>',
    '',
  ].join('\n')

  // Packt in Hintergrund-Threads; Bilder und Modelle sind oft schon komprimiert
  const zipped = await new Promise<Uint8Array>((resolve, reject) =>
    zip({ 'Home.xml': strToU8(xml), ...entries }, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data))),
  )
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })
}

async function pieceXml(
  piece: HomePiece,
  catalogPiece: CatalogPiece | undefined,
  content: (ref: string | null) => Promise<string | null>,
  texture: string[],
): Promise<string> {
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
    color: piece.color === null || piece.texture ? null : formatArgb(piece.color),
    staircaseCutOutShape: piece.staircaseCutOutShape ?? catalogPiece?.staircaseCutOutShape ?? null,
    ...(door && {
      wallThickness: door.wallThickness,
      wallDistance: door.wallDistance,
      cutOutShape: catalogDoor?.cutOutShape ?? null,
      wallCutOutOnBothSides: catalogDoor?.wallCutOutOnBothSides ?? null,
      widthDepthDeformable: door.widthDepthDeformable ? null : false,
    }),
  }
  const light = !door && piece.light ? piece.light : null
  const name = door ? 'doorOrWindow' : light ? 'light' : 'pieceOfFurniture'
  if (light) Object.assign(attributes, { power: light.power })
  // Reihenfolge wie in der DTD von Sweet Home 3D: Flügel bzw. Lichtquellen, Eigenschaften, Textur
  const children = [
    ...(door?.sashes ?? []).map((sash) => `    ${element('sash', { ...sash })}`),
    ...(light?.sources ?? []).map(
      (source) => `    ${element('lightSource', { x: source.x, y: source.y, z: source.z, color: formatArgb(source.color & 0xffffff), diameter: source.diameter || null })}`,
    ),
    ...(piece.libraryId ? [`    ${element('property', { name: LIBRARY_ID_PROPERTY, value: piece.libraryId })}`] : []),
    ...texture,
  ]
  return children.length === 0 ? element(name, attributes) : [`${openTag(name, attributes)}>`, ...children, `  </${name}>`].join('\n')
}

type AttributeValue = string | number | boolean | null | undefined

/** Anfang eines XML-Elements ohne „>“; {@code null}/{@code undefined} werden weggelassen. */
function openTag(name: string, attributes: Record<string, AttributeValue>): string {
  const text = Object.entries(attributes)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null && entry[1] !== undefined)
    .map(([key, value]) => ` ${key}='${escapeXml(String(value))}'`)
    .join('')
  return `<${name}${text}`
}

function element(name: string, attributes: Record<string, AttributeValue>): string {
  return `${openTag(name, attributes)}/>`
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}
