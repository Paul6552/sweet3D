import type { Home, HomePiece, Room, Wall } from './home'

type Change<T extends { id: string }> = Partial<T> & { id: string }

/**
 * Änderungen am Projekt. Befehle sind reine Daten, damit herausgelöste Fenster sie
 * per BroadcastChannel an das Editor-Hauptfenster schicken können.
 */
export type HomeCommand =
  | { type: 'addItems'; walls?: Wall[]; rooms?: Room[]; furniture?: HomePiece[] }
  | { type: 'updateWalls'; changes: Change<Wall>[] }
  | { type: 'updateRooms'; changes: Change<Room>[] }
  | { type: 'updateFurniture'; changes: Change<HomePiece>[] }
  | { type: 'moveItems'; ids: string[]; dx: number; dy: number }
  | { type: 'deleteItems'; ids: string[] }
  /** Mehrere Befehle als ein Undo-Schritt. */
  | { type: 'batch'; commands: HomeCommand[] }

function applyChanges<T extends { id: string }>(items: T[], changes: Change<T>[]): void {
  for (const change of changes) {
    const item = items.find((i) => i.id === change.id)
    if (item) Object.assign(item, change)
  }
}

/** Wendet einen Befehl auf einen immer-Entwurf des Projekts an. */
export function applyCommand(home: Home, command: HomeCommand): void {
  switch (command.type) {
    case 'addItems':
      home.walls.push(...(command.walls ?? []))
      home.rooms.push(...(command.rooms ?? []))
      home.furniture.push(...(command.furniture ?? []))
      break
    case 'updateWalls':
      applyChanges(home.walls, command.changes)
      break
    case 'updateRooms':
      applyChanges(home.rooms, command.changes)
      break
    case 'updateFurniture':
      applyChanges(home.furniture, command.changes)
      break
    case 'moveItems':
      moveItems(home, new Set(command.ids), command.dx, command.dy)
      break
    case 'deleteItems': {
      const ids = new Set(command.ids)
      home.walls = home.walls.filter((w) => !ids.has(w.id))
      home.rooms = home.rooms.filter((r) => !ids.has(r.id))
      home.furniture = home.furniture.filter((p) => !ids.has(p.id))
      // Verbindungen zu gelöschten Wänden lösen
      for (const wall of home.walls) {
        if (wall.wallAtStart && ids.has(wall.wallAtStart)) wall.wallAtStart = null
        if (wall.wallAtEnd && ids.has(wall.wallAtEnd)) wall.wallAtEnd = null
      }
      break
    }
    case 'batch':
      for (const sub of command.commands) applyCommand(home, sub)
      break
  }
}

/**
 * Verschiebt Objekte. Wie in Sweet Home 3D werden die Enden nicht verschobener Wände,
 * die an verschobenen Wänden hängen, mitgezogen, damit die Ecken verbunden bleiben.
 */
function moveItems(home: Home, ids: Set<string>, dx: number, dy: number): void {
  const byId = new Map(home.walls.map((w) => [w.id, w]))
  for (const wall of home.walls) {
    if (!ids.has(wall.id)) continue
    wall.xStart += dx
    wall.yStart += dy
    wall.xEnd += dx
    wall.yEnd += dy
    for (const [neighbourId, atStart] of [[wall.wallAtStart, true], [wall.wallAtEnd, false]] as const) {
      const neighbour = neighbourId ? byId.get(neighbourId) : undefined
      if (!neighbour || ids.has(neighbour.id)) continue
      const x = atStart ? wall.xStart : wall.xEnd
      const y = atStart ? wall.yStart : wall.yEnd
      if (neighbour.wallAtStart === wall.id) {
        neighbour.xStart = x
        neighbour.yStart = y
      } else if (neighbour.wallAtEnd === wall.id) {
        neighbour.xEnd = x
        neighbour.yEnd = y
      }
    }
  }
  for (const room of home.rooms) {
    if (ids.has(room.id)) room.points = room.points.map(([x, y]) => [x + dx, y + dy])
  }
  for (const piece of home.furniture) {
    if (ids.has(piece.id)) {
      piece.x += dx
      piece.y += dy
    }
  }
}
