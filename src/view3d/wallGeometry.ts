import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import { ExtrudeGeometry, Path, Shape, type BufferGeometry } from 'three'
import type { HomePiece, Wall } from '../model/home'
import { pieceCorners, wallPolygon, type Point } from '../model/geometry'

/** Materialgruppen einer Wandscheibe: Stirnseiten, Laibungen und Kanten bleiben in der Standardfarbe. */
export const WALL_DEFAULT = 0
export const WALL_LEFT = 1
export const WALL_RIGHT = 2

export interface WallSlice {
  geometry: BufferGeometry
  /** Unterkante der Scheibe in cm. */
  bottom: number
  top: number
}

const ring = (points: Point[]): Ring => [...points, points[0]]

/**
 * Grundriss einer Tür bzw. eines Fensters zum Ausschneiden aus Wänden; in der Tiefe verlängert,
 * damit die Öffnung auch bei nicht ganz passender Tiefe durch die ganze Wand geht.
 */
function cutOut(piece: HomePiece, wallThickness: number): Ring {
  return ring(pieceCorners({ ...piece, depth: piece.depth + 2 * wallThickness }))
}

function toShapes(multiPolygon: MultiPolygon): Shape[] {
  return multiPolygon.map((polygon: Polygon) => {
    const [outer, ...holes] = polygon
    const shape = new Shape(outer.slice(0, -1).map(([x, y]) => ({ x, y }) as never))
    shape.holes = holes.map((hole) => new Path(hole.slice(0, -1).map(([x, y]) => ({ x, y }) as never)))
    return shape
  })
}

/**
 * Zerlegt eine Wand in Höhenscheiben an den Ober- und Unterkanten der Türen und Fenster.
 * In jeder Scheibe werden die Grundrisse der dort vorhandenen Öffnungen vom Wandumriss
 * abgezogen und die Fläche senkrecht extrudiert (wie Wall3D in Sweet Home 3D).
 */
export function wallSlices(wall: Wall, wallHeight: number, doorsAndWindows: HomePiece[], wallsById: Map<string, Wall>): WallSlice[] {
  const height = wall.height ?? wallHeight
  const outline: Polygon = [ring(wallPolygon(wall, wallsById))]
  const openings = doorsAndWindows
    .filter((p) => p.visible)
    .map((piece) => ({ piece, area: cutOut(piece, wall.thickness) }))
    .filter(({ area }) => polygonClipping.intersection(outline, [area]).length > 0)

  const levels = new Set([0, height])
  for (const { piece } of openings) {
    for (const z of [piece.elevation, piece.elevation + piece.height]) {
      if (z > 0 && z < height) levels.add(z)
    }
  }
  const sorted = [...levels].sort((a, b) => a - b)

  const slices: WallSlice[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const bottom = sorted[i]
    const top = sorted[i + 1]
    const active = openings.filter(({ piece }) => piece.elevation <= bottom && piece.elevation + piece.height >= top)
    const area = active.length > 0 ? polygonClipping.difference(outline, ...active.map(({ area }) => [area] as Polygon)) : [outline]
    if (area.length === 0) continue
    const geometry = new ExtrudeGeometry(toShapes(area), { depth: top - bottom, bevelEnabled: false })
    slices.push({ geometry: assignSides(geometry, wall, top), bottom, top })
  }
  return slices
}

/**
 * Teilt die Dreiecke einer extrudierten Wandscheibe nach Seiten auf (Materialgruppen siehe oben)
 * und setzt UV-Koordinaten in cm: auf den Seiten entlang der Wand und nach oben ab dem Boden
 * der Ebene, auf Ober- und Unterseite wie im Plan. Zugeordnet wird über den Abstand der
 * Dreiecksmitte von der Wandachse, das ist unabhängig vom Umlaufsinn der Dreiecke.
 */
function assignSides(geometry: BufferGeometry, wall: Wall, top: number): BufferGeometry {
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const length = Math.hypot(wall.xEnd - wall.xStart, wall.yEnd - wall.yStart) || 1
  const dx = (wall.xEnd - wall.xStart) / length
  const dy = (wall.yEnd - wall.yStart) / length
  const groups: number[][] = [[], [], []]
  for (let i = 0; i < position.count; i += 3) {
    const zs = [position.getZ(i), position.getZ(i + 1), position.getZ(i + 2)]
    if (zs[0] === zs[1] && zs[1] === zs[2]) {
      // Ober- bzw. Unterseite
      groups[WALL_DEFAULT].push(i, i + 1, i + 2)
      continue
    }
    const cx = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3 - wall.xStart
    const cy = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3 - wall.yStart
    // Abstand nach links in Zeichenrichtung, Normale (sin a, −cos a)
    const offset = cx * dy - cy * dx
    const side = offset > wall.thickness / 4 ? WALL_LEFT : offset < -wall.thickness / 4 ? WALL_RIGHT : WALL_DEFAULT
    for (let j = i; j < i + 3; j++) {
      const x = position.getX(j) - wall.xStart
      const y = position.getY(j) - wall.yStart
      const along = x * dx + y * dy
      // Rechts gespiegelt, damit die Textur von außen gesehen nicht seitenverkehrt ist
      uv.setXY(j, side === WALL_RIGHT ? -along : side === WALL_LEFT ? along : x * dy - y * dx, top - position.getZ(j))
    }
    groups[side].push(i, i + 1, i + 2)
  }
  geometry.setIndex(groups.flat())
  geometry.clearGroups()
  let start = 0
  groups.forEach((indices, material) => {
    geometry.addGroup(start, indices.length, material)
    start += indices.length
  })
  uv.needsUpdate = true
  return geometry
}
