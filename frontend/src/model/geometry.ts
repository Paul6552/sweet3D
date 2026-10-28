import type { HomePiece, Wall } from './home'

/** Punkt im Plan (cm). */
export type Point = [number, number]

export function distance([x1, y1]: Point, [x2, y2]: Point): number {
  return Math.hypot(x2 - x1, y2 - y1)
}

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.xEnd - wall.xStart, wall.yEnd - wall.yStart)
}

export function wallAngle(wall: Wall): number {
  return Math.atan2(wall.yEnd - wall.yStart, wall.xEnd - wall.xStart)
}

/** Schnittpunkt zweier Geraden durch (p1, p2) und (p3, p4); {@code null} bei Parallelen. */
function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
  if (Math.abs(d) < 1e-9) return null
  const a = p1[0] * p2[1] - p1[1] * p2[0]
  const b = p3[0] * p4[1] - p3[1] * p4[0]
  return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d]
}

/** Linke und rechte Seitenlinie einer Wand ohne Eckverbindungen. */
function wallSides(wall: Wall): { left: [Point, Point]; right: [Point, Point] } {
  const angle = wallAngle(wall)
  const dx = (Math.sin(angle) * wall.thickness) / 2
  const dy = (Math.cos(angle) * wall.thickness) / 2
  return {
    left: [[wall.xStart + dx, wall.yStart - dy], [wall.xEnd + dx, wall.yEnd - dy]],
    right: [[wall.xStart - dx, wall.yStart + dy], [wall.xEnd - dx, wall.yEnd + dy]],
  }
}

/**
 * Umriss einer Wand als Viereck [linker Start, linkes Ende, rechtes Ende, rechter Start].
 * An verbundenen Enden werden die Seitenlinien wie in Sweet Home 3D (Wall.getPoints) bis zum
 * Schnittpunkt mit der Nachbarwand verlängert bzw. gekürzt, damit saubere Gehrungen entstehen.
 */
export function wallPolygon(wall: Wall, wallsById: Map<string, Wall>): Point[] {
  const { left, right } = wallSides(wall)
  const points: Point[] = [left[0], left[1], right[1], right[0]]
  const limit = wall.thickness * 3

  const join = (neighbourId: string | null, atStart: boolean) => {
    const neighbour = neighbourId ? wallsById.get(neighbourId) : undefined
    if (!neighbour) return
    const sides = wallSides(neighbour)
    // Hängt die Nachbarwand mit ihrem Ende an unserem Start, laufen beide in gleicher Richtung
    const sameDirection = atStart ? neighbour.wallAtEnd === wall.id : neighbour.wallAtStart === wall.id
    const reversed = atStart ? neighbour.wallAtStart === wall.id : neighbour.wallAtEnd === wall.id
    if (!sameDirection && !reversed) return
    const neighbourLeft = sameDirection ? sides.left : sides.right
    const neighbourRight = sameDirection ? sides.right : sides.left
    const leftJoin = lineIntersection(left[0], left[1], neighbourLeft[0], neighbourLeft[1])
    const rightJoin = lineIntersection(right[0], right[1], neighbourRight[0], neighbourRight[1])
    const end: Point = atStart ? [wall.xStart, wall.yStart] : [wall.xEnd, wall.yEnd]
    // Sehr spitze Winkel ergäben extrem lange Gehrungen: dann ohne Verbindung zeichnen
    if (leftJoin && rightJoin && distance(leftJoin, end) < limit && distance(rightJoin, end) < limit) {
      if (atStart) {
        points[0] = leftJoin
        points[3] = rightJoin
      } else {
        points[1] = leftJoin
        points[2] = rightJoin
      }
    }
  }
  join(wall.wallAtStart, true)
  join(wall.wallAtEnd, false)
  return points
}

/** Die vier Ecken eines Möbels im Plan, beginnend links oben (im Uhrzeigersinn). */
export function pieceCorners(piece: Pick<HomePiece, 'x' | 'y' | 'width' | 'depth' | 'angle'>): Point[] {
  const cos = Math.cos(piece.angle)
  const sin = Math.sin(piece.angle)
  return (
    [
      [-piece.width / 2, -piece.depth / 2],
      [piece.width / 2, -piece.depth / 2],
      [piece.width / 2, piece.depth / 2],
      [-piece.width / 2, piece.depth / 2],
    ] as Point[]
  ).map(([x, y]) => [piece.x + x * cos - y * sin, piece.y + x * sin + y * cos])
}

/** Wandelt einen Planpunkt in das lokale Koordinatensystem eines Möbels um. */
export function toPieceLocal(piece: Pick<HomePiece, 'x' | 'y' | 'angle'>, [x, y]: Point): Point {
  const cos = Math.cos(-piece.angle)
  const sin = Math.sin(-piece.angle)
  const dx = x - piece.x
  const dy = y - piece.y
  return [dx * cos - dy * sin, dx * sin + dy * cos]
}

export function pointInPolygon([x, y]: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Fläche (cm², immer positiv) nach der Gaußschen Trapezformel. */
export function polygonArea(polygon: Point[]): number {
  let sum = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1])
  }
  return Math.abs(sum / 2)
}

export function polygonCentroid(polygon: Point[]): Point {
  let x = 0
  let y = 0
  let area = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const f = polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1]
    x += (polygon[j][0] + polygon[i][0]) * f
    y += (polygon[j][1] + polygon[i][1]) * f
    area += f
  }
  if (Math.abs(area) < 1e-9) {
    return [polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length]
  }
  return [x / (3 * area), y / (3 * area)]
}

/** Nächster Punkt auf der Strecke (a, b) und der Anteil t entlang der Strecke. */
export function projectOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared))
  return { point: [a[0] + t * dx, a[1] + t * dy], t }
}

export function rectContains(rect: { x1: number; y1: number; x2: number; y2: number }, [x, y]: Point): boolean {
  return x >= Math.min(rect.x1, rect.x2) && x <= Math.max(rect.x1, rect.x2) && y >= Math.min(rect.y1, rect.y2) && y <= Math.max(rect.y1, rect.y2)
}
