import type { Home, HomePiece, Wall } from './home'

/**
 * Änderungen am Projekt. Befehle sind reine Daten, damit herausgelöste Fenster sie
 * per BroadcastChannel an das Editor-Hauptfenster schicken können.
 */
export type HomeCommand =
  | { type: 'addWalls'; walls: Wall[] }
  | { type: 'addFurniture'; pieces: HomePiece[] }
  | { type: 'updateFurniture'; changes: (Partial<HomePiece> & { id: string })[] }
  | { type: 'deleteItems'; ids: string[] }

/** Wendet einen Befehl auf einen immer-Entwurf des Projekts an. */
export function applyCommand(home: Home, command: HomeCommand): void {
  switch (command.type) {
    case 'addWalls':
      home.walls.push(...command.walls)
      break
    case 'addFurniture':
      home.furniture.push(...command.pieces)
      break
    case 'updateFurniture':
      for (const change of command.changes) {
        const piece = home.furniture.find((p) => p.id === change.id)
        if (piece) {
          Object.assign(piece, change)
        }
      }
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
  }
}
