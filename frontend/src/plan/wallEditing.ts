import type { HomeCommand } from '../model/commands'
import { newId, type Home, type Wall } from '../model/home'
import type { Point } from '../model/geometry'
import type { WallEndSnap } from './magnetism'

export const DEFAULT_WALL_THICKNESS = 15

/**
 * Befehl für eine neue Wand von {@code start} nach {@code end}. Die Wand wird mit der
 * vorherigen Wand der Kette bzw. mit getroffenen freien Wandenden verbunden.
 */
export function createWallCommand(
  start: Point,
  end: Point,
  startJoin: WallEndSnap | null,
  endJoin: WallEndSnap | null,
): { command: HomeCommand; wall: Wall } {
  const wall: Wall = {
    id: newId('wall'),
    xStart: start[0],
    yStart: start[1],
    xEnd: end[0],
    yEnd: end[1],
    wallAtStart: startJoin?.wall?.id ?? null,
    wallAtEnd: endJoin?.wall?.id ?? null,
    thickness: DEFAULT_WALL_THICKNESS,
    height: null,
    level: null,
  }
  const changes = [startJoin, endJoin]
    .filter((join): join is WallEndSnap & { wall: Wall } => join?.wall != null)
    .map((join) => (join.atStart ? { id: join.wall.id, wallAtStart: wall.id } : { id: join.wall.id, wallAtEnd: wall.id }))
  return {
    wall,
    command: { type: 'batch', commands: [{ type: 'addItems', walls: [wall] }, { type: 'updateWalls', changes }] },
  }
}

/**
 * Verschiebt ein Wandende; die daran hängende Nachbarwand wird mitgezogen, damit die Ecke bleibt.
 */
export function moveWallEndCommand(home: Home, wall: Wall, atStart: boolean, point: Point): HomeCommand {
  const changes: (Partial<Wall> & { id: string })[] = [
    atStart ? { id: wall.id, xStart: point[0], yStart: point[1] } : { id: wall.id, xEnd: point[0], yEnd: point[1] },
  ]
  const neighbourId = atStart ? wall.wallAtStart : wall.wallAtEnd
  const neighbour = home.walls.find((w) => w.id === neighbourId)
  if (neighbour?.wallAtStart === wall.id) changes.push({ id: neighbour.id, xStart: point[0], yStart: point[1] })
  else if (neighbour?.wallAtEnd === wall.id) changes.push({ id: neighbour.id, xEnd: point[0], yEnd: point[1] })
  return { type: 'updateWalls', changes }
}
