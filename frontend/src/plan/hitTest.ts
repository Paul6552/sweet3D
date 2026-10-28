import type { Home, HomePiece, ObserverCamera, Wall } from '../model/home'
import { distance, pieceCorners, pointInPolygon, wallPolygon, type Point } from '../model/geometry'

export type ItemKind = 'piece' | 'wall' | 'room'

export interface Hit {
  kind: ItemKind
  id: string
}

export type Handle =
  | { kind: 'rotate'; piece: HomePiece }
  | { kind: 'resize'; piece: HomePiece }
  | { kind: 'wallStart'; wall: Wall }
  | { kind: 'wallEnd'; wall: Wall }

/** Oberstes Objekt am Punkt: Möbel vor Wänden vor Räumen (wie in Sweet Home 3D). */
export function hitItem(home: Home, point: Point): Hit | null {
  for (let i = home.furniture.length - 1; i >= 0; i--) {
    const piece = home.furniture[i]
    if (piece.visible && pointInPolygon(point, pieceCorners(piece))) return { kind: 'piece', id: piece.id }
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
  ]
}

/** Umgebendes Rechteck aller Objekte, {@code null} bei leerem Projekt. */
export function homeBounds(home: Home): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points: Point[] = [
    ...home.walls.flatMap((w): Point[] => [[w.xStart, w.yStart], [w.xEnd, w.yEnd]]),
    ...home.rooms.flatMap((r) => r.points),
    ...home.furniture.flatMap((p) => pieceCorners(p)),
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
