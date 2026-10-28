import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import { ExtrudeGeometry, Path, Shape, type BufferGeometry } from 'three'
import type { HomePiece, Wall } from '../model/home'
import { pieceCorners, wallPolygon, type Point } from '../model/geometry'

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
    slices.push({ geometry, bottom, top })
  }
  return slices
}
