import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping'
import { Shape, ShapeGeometry } from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import type { Home, HomePiece } from '../model/home'
import { levelElevation } from '../model/levels'
import type { Point } from '../model/geometry'
import { toShapes } from './wallGeometry'

/** Liefert die Öffnung einer Treppe als SVG-Pfad oder {@code null}, wenn das Möbel keine Treppe ist. */
export type StaircaseShapeOf = (piece: HomePiece) => string | null

/** Umrisse je SVG-Pfad im Einheitsquadrat; ein Katalog hat nur wenige verschiedene. */
const unitOutlines = new Map<string, Point[][]>()

function unitOutline(path: string): Point[][] {
  let outlines = unitOutlines.get(path)
  if (!outlines) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${path.replace(/"/g, '')}"/></svg>`
    outlines = new SVGLoader()
      .parse(svg)
      .paths.flatMap((p) => p.subPaths)
      .map((sub) => sub.getPoints(16).map((v) => [v.x, v.y] as Point))
      .filter((points) => points.length >= 3)
    unitOutlines.set(path, outlines)
  }
  return outlines
}

/** Öffnung einer Treppe im Plan: Einheitsquadrat auf Breite × Tiefe des Möbels, gedreht wie pieceCorners. */
function staircaseOutline(piece: HomePiece, path: string): Ring[] {
  const cos = Math.cos(piece.angle)
  const sin = Math.sin(piece.angle)
  return unitOutline(path).map((points) => {
    const ring = points.map(([u, v]): Point => {
      const x = (u - 0.5) * piece.width
      const y = (v - 0.5) * piece.depth
      return [piece.x + x * cos - y * sin, piece.y + x * sin + y * cos]
    })
    return [...ring, ring[0]]
  })
}

/**
 * Öffnungen aller sichtbaren Treppen, die durch die Schicht {@code bottom..top} (Höhen über dem Gelände)
 * reichen, wie in Sweet Home 3D: Treppen schneiden Böden der Ebenen darüber und Decken, über die sie hinausgehen.
 * {@code accept}: weitere Bedingung je Treppe mit ihrer Ober- und Unterkante (z. B. für Dächer).
 */
export function staircaseHoles(
  home: Home,
  bottom: number,
  top: number,
  shapeOf: StaircaseShapeOf,
  accept?: (piece: HomePiece, pieceBottom: number, pieceTop: number) => boolean,
): Polygon[] {
  const holes: Polygon[] = []
  for (const piece of home.furniture) {
    const path = piece.visible ? shapeOf(piece) : null
    if (!path) continue
    const pieceBottom = levelElevation(home, piece.level) + piece.elevation
    const pieceTop = pieceBottom + piece.height
    if (pieceBottom < top && pieceTop > bottom && (!accept || accept(piece, pieceBottom, pieceTop))) holes.push(...staircaseOutline(piece, path).map((ring) => [ring]))
  }
  return holes
}

/** Fläche eines Raums (Boden oder Decke), ohne die Öffnungen der Treppen. */
export function roomGeometry(points: [number, number][], holes: Polygon[]): ShapeGeometry {
  const outline: Polygon = [[...points, points[0]]]
  let cut = null
  try {
    if (holes.length > 0 && points.length >= 3) cut = polygonClipping.difference(outline, ...holes)
  } catch {
    // Ungültiger Umriss (z. B. sich selbst schneidend): Raum ohne Öffnung zeichnen
  }
  return new ShapeGeometry(cut ? toShapes(cut) : new Shape(points.map(([x, y]) => ({ x, y }) as never)))
}
