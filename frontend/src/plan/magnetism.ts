import type { Home, HomePiece, Wall } from '../model/home'
import { distance, projectOnSegment, wallAngle, wallPolygon, type Point } from '../model/geometry'

const ANGLE_STEP = Math.PI / 12 // 15°

export interface WallEndSnap {
  point: Point
  /** Wand, deren freies Ende getroffen wurde, und an welchem Ende. */
  wall: Wall | null
  atStart: boolean
}

/**
 * Sucht ein freies Wandende in der Nähe (Toleranz in cm). Wände in {@code exclude} werden ignoriert.
 */
export function snapToFreeWallEnd(home: Home, point: Point, tolerance: number, exclude: Set<string> = new Set()): WallEndSnap | null {
  let best: WallEndSnap | null = null
  let bestDistance = tolerance
  for (const wall of home.walls) {
    if (exclude.has(wall.id)) continue
    for (const atStart of [true, false]) {
      if ((atStart ? wall.wallAtStart : wall.wallAtEnd) !== null) continue
      const end: Point = atStart ? [wall.xStart, wall.yStart] : [wall.xEnd, wall.yEnd]
      const d = distance(point, end)
      if (d <= bestDistance) {
        bestDistance = d
        best = { point: end, wall, atStart }
      }
    }
  }
  return best
}

/**
 * Magnetismus beim Zeichnen einer Wand von {@code start} aus: Winkel in 15°-Schritten,
 * Länge auf ganze Zentimeter (bei kleinem Maßstab auf 5 bzw. 10 cm).
 */
export function magnetizeWallEnd(start: Point, point: Point, scale: number): Point {
  const length = distance(start, point)
  if (length < 1e-6) return point
  const angle = Math.round(Math.atan2(point[1] - start[1], point[0] - start[0]) / ANGLE_STEP) * ANGLE_STEP
  const step = scale < 0.5 ? 10 : scale < 1.5 ? 5 : 1
  const rounded = Math.max(step, Math.round(length / step) * step)
  return [start[0] + Math.cos(angle) * rounded, start[1] + Math.sin(angle) * rounded].map((v) => Math.round(v * 10) / 10) as Point
}

export function snapAngle(angle: number): number {
  return Math.round(angle / ANGLE_STEP) * ANGLE_STEP
}

/**
 * Setzt eine Tür bzw. ein Fenster in die nächstgelegene Wand: Ausrichtung parallel zur Wand,
 * der Wandanteil des Möbels liegt mittig in der Wand, bei verformbaren Elementen passt sich die
 * Tiefe der Wanddicke an. Liefert {@code null}, wenn keine Wand nahe genug ist.
 */
export function snapDoorOrWindowToWall(
  home: Home,
  piece: Pick<HomePiece, 'x' | 'y' | 'width' | 'depth' | 'angle' | 'doorOrWindowInfo'>,
): Pick<HomePiece, 'x' | 'y' | 'angle' | 'depth'> | null {
  const info = piece.doorOrWindowInfo
  if (!info) return null
  const center: Point = [piece.x, piece.y]
  let best: { wall: Wall; point: Point; d: number } | null = null
  for (const wall of home.walls) {
    const { point } = projectOnSegment(center, [wall.xStart, wall.yStart], [wall.xEnd, wall.yEnd])
    const d = distance(center, point)
    // Nur Wände, die nahe genug sind, und nicht über die Ecke hinaus
    if (d <= wall.thickness / 2 + piece.depth && (!best || d < best.d)) best = { wall, point, d }
  }
  if (!best) return null
  const { wall, point } = best
  const wallDirection = wallAngle(wall)
  // Die Vorderseite (lokal +y) zeigt zu der Seite der Wand, auf der der Mauszeiger ist;
  // wallDistance wird wie in Sweet Home 3D von der Rückseite (lokal -y) aus gemessen
  const side = Math.sign((center[0] - point[0]) * -Math.sin(wallDirection) + (center[1] - point[1]) * Math.cos(wallDirection)) || 1
  const angle = side > 0 ? wallDirection : wallDirection + Math.PI
  const depth = info.widthDepthDeformable && info.wallThickness > 0 ? wall.thickness / info.wallThickness : piece.depth
  // Abstand der Wandmitte vom Möbelmittelpunkt in lokaler y-Richtung
  const offset = -depth / 2 + depth * (info.wallDistance + info.wallThickness / 2)
  const localY: Point = [-Math.sin(angle), Math.cos(angle)]
  return {
    x: Math.round((point[0] - localY[0] * offset) * 10) / 10,
    y: Math.round((point[1] - localY[1] * offset) * 10) / 10,
    angle: normalizeAngle(angle),
    depth: Math.round(depth * 10) / 10,
  }
}

export function normalizeAngle(angle: number): number {
  const full = Math.PI * 2
  return ((angle % full) + full) % full
}

/** Ecken des Wandumrisses, auf die beim Zeichnen von Räumen eingerastet wird. */
export function roomSnapPoints(home: Home): Point[] {
  const byId = new Map(home.walls.map((w) => [w.id, w]))
  return [...home.walls.flatMap((w) => wallPolygon(w, byId)), ...home.rooms.flatMap((r) => r.points)]
}

export function snapToPoints(point: Point, candidates: Point[], tolerance: number): Point {
  let best = point
  let bestDistance = tolerance
  for (const candidate of candidates) {
    const d = distance(point, candidate)
    if (d <= bestDistance) {
      bestDistance = d
      best = candidate
    }
  }
  return best
}
