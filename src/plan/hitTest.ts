import type { Compass, DimensionLine, Home, HomePiece, ObserverCamera, Roof, Wall } from '../model/home'
import { dimensionOffsetPoints, distance, distanceToSegment, labelCorners, pieceCorners, pointInPolygon, wallPolygon, type Point } from '../model/geometry'
import { rawRoofModel } from '../model/roofs'

export type ItemKind = 'piece' | 'wall' | 'room' | 'roof' | 'dimensionLine' | 'label'

export interface Hit {
  kind: ItemKind
  id: string
}

export type Handle =
  | { kind: 'rotate'; piece: HomePiece }
  | { kind: 'resize'; piece: HomePiece }
  | { kind: 'wallStart'; wall: Wall }
  | { kind: 'wallEnd'; wall: Wall }
  | { kind: 'dimensionStart'; line: DimensionLine }
  | { kind: 'dimensionEnd'; line: DimensionLine }
  | { kind: 'dimensionOffset'; line: DimensionLine }
  /** Ecke {@code index} eines Dachs verschieben. */
  | { kind: 'roofPoint'; roof: Roof; index: number }
  /** Mitte der Kante {@code index}: Ziehen fügt dort eine Ecke ein. */
  | { kind: 'roofMid'; roof: Roof; index: number }

/**
 * Trifft der Punkt das Dach? Nur am Überstand (zwischen Wandlinie und Traufe) und an First, Graten
 * und Kehlen, damit Räume und Wände darunter weiter mit einem Klick erreichbar sind.
 */
export function hitRoof(home: Home, roof: Roof, point: Point, tolerance: number): boolean {
  const model = rawRoofModel(home, roof)
  if (model.outline.length === 0) return false
  const outer = model.outline[0]
  if (!pointInPolygon(point, outer) && !outer.some((a, i) => distanceToSegment(point, a, outer[(i + 1) % outer.length]) <= tolerance)) return false
  const wall = model.wallLine[0]
  if (!pointInPolygon(point, wall)) return true
  if (wall.some((a, i) => distanceToSegment(point, a, wall[(i + 1) % wall.length]) <= tolerance)) return true
  return model.lines.some(([a, b]) => distanceToSegment(point, [a[0], a[1]], [b[0], b[1]]) <= tolerance)
}

/**
 * Oberstes Objekt am Punkt: Texte und Maßlinien vor Möbeln vor Wänden vor Räumen (wie in
 * Sweet Home 3D). {@code tolerance} in cm für die dünnen Maßlinien.
 */
export function hitItem(home: Home, point: Point, tolerance = 0): Hit | null {
  for (let i = home.labels.length - 1; i >= 0; i--) {
    if (pointInPolygon(point, labelCorners(home.labels[i]))) return { kind: 'label', id: home.labels[i].id }
  }
  for (let i = home.dimensionLines.length - 1; i >= 0; i--) {
    const [a, b] = dimensionOffsetPoints(home.dimensionLines[i])
    if (distanceToSegment(point, a, b) <= Math.max(tolerance, 2)) return { kind: 'dimensionLine', id: home.dimensionLines[i].id }
  }
  for (let i = home.furniture.length - 1; i >= 0; i--) {
    const piece = home.furniture[i]
    if (piece.visible && pointInPolygon(point, pieceCorners(piece))) return { kind: 'piece', id: piece.id }
  }
  for (let i = home.roofs.length - 1; i >= 0; i--) {
    if (hitRoof(home, home.roofs[i], point, Math.max(tolerance, 2))) return { kind: 'roof', id: home.roofs[i].id }
  }
  const byId = new Map(home.walls.map((w) => [w.id, w]))
  for (let i = home.walls.length - 1; i >= 0; i--) {
    if (pointInPolygon(point, wallPolygon(home.walls[i], byId))) return { kind: 'wall', id: home.walls[i].id }
  }
  for (let i = home.rooms.length - 1; i >= 0; i--) {
    if (pointInPolygon(point, home.rooms[i].points)) return { kind: 'room', id: home.rooms[i].id }
  }
  return null
}

/** Griffpunkte des einzeln ausgewählten Objekts. */
export function handlePoints(home: Home, selection: string[]): { handle: Handle; point: Point }[] {
  if (selection.length !== 1) return []
  const piece = home.furniture.find((p) => p.id === selection[0])
  if (piece) {
    const corners = pieceCorners(piece)
    return [
      { handle: { kind: 'rotate', piece }, point: corners[0] },
      { handle: { kind: 'resize', piece }, point: corners[2] },
    ]
  }
  const line = home.dimensionLines.find((d) => d.id === selection[0])
  if (line) {
    const [a, b] = dimensionOffsetPoints(line)
    return [
      { handle: { kind: 'dimensionStart', line }, point: a },
      { handle: { kind: 'dimensionEnd', line }, point: b },
      { handle: { kind: 'dimensionOffset', line }, point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
    ]
  }
  const roof = home.roofs.find((r) => r.id === selection[0])
  if (roof) {
    const n = roof.points.length
    return [
      ...roof.points.map((point, index) => ({ handle: { kind: 'roofPoint', roof, index } as Handle, point })),
      ...roof.points.map((a, index) => {
        const b = roof.points[(index + 1) % n]
        return { handle: { kind: 'roofMid', roof, index } as Handle, point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Point }
      }),
    ]
  }
  const wall = home.walls.find((w) => w.id === selection[0])
  if (wall) {
    return [
      { handle: { kind: 'wallStart', wall }, point: [wall.xStart, wall.yStart] },
      { handle: { kind: 'wallEnd', wall }, point: [wall.xEnd, wall.yEnd] },
    ]
  }
  return []
}

export function hitHandle(home: Home, selection: string[], point: Point, tolerance: number): Handle | null {
  return handlePoints(home, selection).find((h) => distance(h.point, point) <= tolerance)?.handle ?? null
}

/** Ids aller Objekte, die vollständig im Rechteck liegen. */
export function itemsInRect(home: Home, a: Point, b: Point): string[] {
  const minX = Math.min(a[0], b[0])
  const maxX = Math.max(a[0], b[0])
  const minY = Math.min(a[1], b[1])
  const maxY = Math.max(a[1], b[1])
  const inside = (points: Point[]) => points.every(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY)
  return [
    ...home.furniture.filter((p) => p.visible && inside(pieceCorners(p))).map((p) => p.id),
    ...home.walls.filter((w) => inside([[w.xStart, w.yStart], [w.xEnd, w.yEnd]])).map((w) => w.id),
    ...home.rooms.filter((r) => inside(r.points)).map((r) => r.id),
    ...home.roofs.filter((r) => inside(r.points)).map((r) => r.id),
    ...home.dimensionLines.filter((d) => inside(dimensionOffsetPoints(d))).map((d) => d.id),
    ...home.labels.filter((l) => inside([[l.x, l.y]])).map((l) => l.id),
  ]
}

/** Umgebendes Rechteck aller Objekte, {@code null} bei leerem Projekt. */
export function homeBounds(home: Home): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points: Point[] = [
    ...home.walls.flatMap((w): Point[] => [[w.xStart, w.yStart], [w.xEnd, w.yEnd]]),
    ...home.rooms.flatMap((r) => r.points),
    ...home.roofs.flatMap((r) => r.points),
    ...home.furniture.flatMap((p) => pieceCorners(p)),
    ...home.dimensionLines.flatMap((d) => dimensionOffsetPoints(d)),
    ...home.labels.map((l): Point => [l.x, l.y]),
  ]
  if (points.length === 0) return null
  return {
    minX: Math.min(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxX: Math.max(...points.map((p) => p[0])),
    maxY: Math.max(...points.map((p) => p[1])),
  }
}

export const OBSERVER_RADIUS = 20

/** Drehgriff des Besuchers vor seinem Kopf in Blickrichtung. */
export function observerHandle(observer: ObserverCamera): Point {
  return [observer.x + Math.cos(observer.yaw) * 70, observer.y + Math.sin(observer.yaw) * 70]
}

/** Trifft der Punkt den sichtbaren Besucher (Kopf oder Drehgriff)? */
export function hitObserver(home: Home, point: Point, tolerance: number): 'move' | 'rotate' | null {
  if (home.camera.mode !== 'observer') return null
  const observer = home.camera.observer
  if (distance(observerHandle(observer), point) <= tolerance) return 'rotate'
  if (distance([observer.x, observer.y], point) <= OBSERVER_RADIUS + tolerance / 2) return 'move'
  return null
}

/** Kleinster Durchmesser des Kompasses am Bildschirm in Pixeln, damit er bei kleinem Zoom lesbar bleibt. */
const COMPASS_MIN_PX = 64

/** Radius des Kompasses im Plan (cm): sein Durchmesser, aber am Bildschirm nie kleiner als COMPASS_MIN_PX. */
export function compassRadius(compass: Compass, scale: number): number {
  return Math.max(compass.diameter, COMPASS_MIN_PX / scale) / 2
}

/** Trifft der Punkt den sichtbaren Kompass? */
export function hitCompass(home: Home, point: Point, scale: number, tolerance: number): boolean {
  const { compass } = home
  return compass.visible && distance([compass.x, compass.y], point) <= compassRadius(compass, scale) + tolerance
}
