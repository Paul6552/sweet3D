import { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import { clipping } from '../model/clipping'
import { ExtrudeGeometry, Path, Shape, type BufferGeometry } from 'three'
import type { HomePiece, Wall } from '../model/home'
import { pieceCorners, wallPolygon, type Point } from '../model/geometry'
import { halfPlane, linearZ, tryClip, type LinearHeight, type WallCap } from '../model/roofs'

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

/** Polygone (mit Löchern) aus polygon-clipping als three.js-Formen. */
export function toShapes(multiPolygon: MultiPolygon): Shape[] {
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
 * {@code floorThickness}: so weit reicht die Wand unter den Boden der Ebene, damit zwischen den Wänden
 * übereinanderliegender Ebenen keine Fuge in der Dicke der Decke bleibt.
 * {@code caps}: Teile des Grundrisses mit eigener, linearer Oberkante (Wand bis zum Dach, siehe
 * wallCaps); in einer Scheibe, durch die eine schräge Oberkante läuft, wird der Teil darunter extrudiert
 * und seine Deckfläche auf die Oberkante gelegt.
 */
export function wallSlices(
  wall: Wall,
  wallHeight: number,
  doorsAndWindows: HomePiece[],
  wallsById: Map<string, Wall>,
  floorThickness = 0,
  caps?: WallCap[],
): WallSlice[] {
  const height = wall.height ?? wallHeight
  const polygon = wallPolygon(wall, wallsById)
  const outline: Polygon = [ring(polygon)]
  const parts: WallCap[] = caps ?? [{ area: [outline], height: [0, 0, height] as LinearHeight }]
  const openings = doorsAndWindows
    .filter((p) => p.visible)
    .map((piece) => ({ piece, area: cutOut(piece, wall.thickness) }))
    .filter(({ area }) => clipping.intersection(outline, [area]).length > 0)

  // Höchster Punkt der Oberkante: bei linearer Höhe an einer Ecke der Teilfläche
  const tops = parts.map(({ area, height: h }) => Math.max(...area.flatMap((poly) => poly[0].map((p) => linearZ(h, p as Point)))))
  const top = Math.max(...tops)
  if (!(top > -floorThickness)) return []
  const levels = new Set([-floorThickness, 0, top])
  for (const { height: h } of parts) if (h[0] === 0 && h[1] === 0) levels.add(h[2])
  for (const { piece } of openings) {
    for (const z of [piece.elevation, piece.elevation + piece.height]) levels.add(z)
  }
  const sorted = [...levels].filter((z) => z >= -floorThickness && z <= top).sort((a, b) => a - b)

  const slices: WallSlice[] = []
  const add = (area: MultiPolygon, bottom: number, sliceTop: number, cap: WallCap | null) => {
    if (area.length === 0) return
    const depth = sliceTop - bottom
    const geometry = new ExtrudeGeometry(toShapes(area), { depth, bevelEnabled: false })
    if (cap) {
      // Deck- (z = 0, Szenenhöhe sliceTop) und Grundfläche (z = depth) auf Ober- und Unterkante legen
      const clamp = (z: number) => Math.min(sliceTop, Math.max(bottom, z))
      const position = geometry.getAttribute('position')
      for (let i = 0; i < position.count; i++) {
        const p: Point = [position.getX(i), position.getY(i)]
        const top = clamp(linearZ(cap.height, p))
        const atTop = Math.abs(position.getZ(i)) < 1e-6
        const z = atTop ? top : Math.min(top, cap.bottom ? clamp(linearZ(cap.bottom, p)) : bottom)
        position.setZ(i, sliceTop - z)
      }
      geometry.computeVertexNormals()
    }
    slices.push({ geometry: assignSides(geometry, wall, sliceTop), bottom, top: sliceTop })
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const bottom = sorted[i]
    const sliceTop = sorted[i + 1]
    if (sliceTop - bottom < 1e-6) continue
    const active = openings.filter(({ piece }) => piece.elevation <= bottom && piece.elevation + piece.height >= sliceTop)
    const cut = (area: MultiPolygon) => (active.length > 0 && area.length > 0 ? tryClip(() => clipping.difference(area, ...active.map(({ area }) => [area] as Polygon)), area) : area)
    const full: MultiPolygon[] = []
    for (const cap of parts) {
      const [gx, gy, g0] = cap.height
      if (gx === 0 && gy === 0 && !cap.bottom) {
        // Waagrechte Oberkante: Ihre Höhe ist eine Scheibengrenze
        if (g0 >= sliceTop) full.push(cap.area)
        continue
      }
      // Teil der Scheibe, in dem die Oberkante über ihrer Unterseite und die Unterkante unter ihrer Oberseite liegt
      const over = halfPlane(-gx, -gy, g0 - bottom, polygon)
      const under = cap.bottom ? halfPlane(cap.bottom[0], cap.bottom[1], sliceTop - cap.bottom[2], polygon) : null
      if (!over || (cap.bottom && !under)) continue
      const area = tryClip(() => clipping.intersection(cap.area, over, ...(under ? [under] : [])), [])
      if (area.length > 0) add(cut(area), bottom, sliceTop, cap)
    }
    if (full.length > 0) add(cut(full.length === 1 ? full[0] : tryClip(() => clipping.union(full[0], ...full.slice(1)), full.flat())), bottom, sliceTop, null)
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
    // Ober- und Unterseite (auch schräg unter dem Dach) stehen nicht senkrecht
    const ex = position.getX(i + 1) - position.getX(i)
    const ey = position.getY(i + 1) - position.getY(i)
    const fx = position.getX(i + 2) - position.getX(i)
    const fy = position.getY(i + 2) - position.getY(i)
    if (Math.abs(ex * fy - ey * fx) > 1e-6) {
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
