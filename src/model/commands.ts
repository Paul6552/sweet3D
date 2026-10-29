import { homeItems, type DimensionLine, type Home, type HomePiece, type Label, type Level, type Room, type Wall } from './home'
import { sortLevels } from './levels'

type Change<T extends { id: string }> = Partial<T> & { id: string }

/**
 * Änderungen am Projekt. Befehle sind reine Daten, damit herausgelöste Fenster sie
 * per BroadcastChannel an das Editor-Hauptfenster schicken können.
 */
export type HomeCommand =
  | { type: 'addItems'; walls?: Wall[]; rooms?: Room[]; furniture?: HomePiece[]; dimensionLines?: DimensionLine[]; labels?: Label[] }
  | { type: 'updateWalls'; changes: Change<Wall>[] }
  | { type: 'updateRooms'; changes: Change<Room>[] }
  | { type: 'updateFurniture'; changes: Change<HomePiece>[] }
  | { type: 'updateDimensionLines'; changes: Change<DimensionLine>[] }
  | { type: 'updateLabels'; changes: Change<Label>[] }
  | { type: 'moveItems'; ids: string[]; dx: number; dy: number }
  | { type: 'deleteItems'; ids: string[] }
  /**
   * Ebenen hinzufügen und die letzte auswählen. {@code assignExistingTo}: Ebene, auf die alle
   * bisherigen Objekte kommen (beim ersten Anlegen von Ebenen).
   */
  | { type: 'addLevels'; levels: Level[]; assignExistingTo: string | null }
  | { type: 'updateLevel'; change: Change<Level> }
  /** Löscht die Ebene samt ihrer Objekte. */
  | { type: 'deleteLevel'; id: string }
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
    case 'addItems': {
      // Neue Objekte (auch eingefügte) kommen immer auf die gewählte Ebene
      const level = home.selectedLevel
      home.walls.push(...(command.walls ?? []).map((w) => ({ ...w, level })))
      home.rooms.push(...(command.rooms ?? []).map((r) => ({ ...r, level })))
      home.furniture.push(...(command.furniture ?? []).map((p) => ({ ...p, level })))
      home.dimensionLines.push(...(command.dimensionLines ?? []).map((d) => ({ ...d, level })))
      home.labels.push(...(command.labels ?? []).map((l) => ({ ...l, level })))
      break
    }
    case 'addLevels':
      if (command.assignExistingTo) {
        for (const item of homeItems(home)) item.level ??= command.assignExistingTo
      }
      home.levels = sortLevels([...home.levels, ...command.levels])
      home.selectedLevel = command.levels[command.levels.length - 1]?.id ?? home.selectedLevel
      break
    case 'updateLevel': {
      const level = home.levels.find((l) => l.id === command.change.id)
      if (level) Object.assign(level, command.change)
      home.levels = sortLevels(home.levels)
      break
    }
    case 'deleteLevel': {
      const index = home.levels.findIndex((l) => l.id === command.id)
      if (index < 0) break
      const onLevel = new Set(homeItems(home).filter((i) => i.level === command.id).map((i) => i.id))
      applyCommand(home, { type: 'deleteItems', ids: [...onLevel] })
      home.levels.splice(index, 1)
      if (home.selectedLevel === command.id) home.selectedLevel = home.levels[Math.max(0, index - 1)]?.id ?? null
      if (home.levels.length === 0) {
        // Letzte Ebene gelöscht: wieder ein Projekt ohne Ebenen
        for (const item of homeItems(home)) item.level = null
      }
      break
    }
    case 'updateWalls':
      applyChanges(home.walls, command.changes)
      break
    case 'updateRooms':
      applyChanges(home.rooms, command.changes)
      break
    case 'updateFurniture':
      applyChanges(home.furniture, command.changes)
      break
    case 'updateDimensionLines':
      applyChanges(home.dimensionLines, command.changes)
      break
    case 'updateLabels':
      applyChanges(home.labels, command.changes)
      break
    case 'moveItems':
      moveItems(home, new Set(command.ids), command.dx, command.dy)
      break
    case 'deleteItems': {
      const ids = new Set(command.ids)
      home.walls = home.walls.filter((w) => !ids.has(w.id))
      home.rooms = home.rooms.filter((r) => !ids.has(r.id))
      home.furniture = home.furniture.filter((p) => !ids.has(p.id))
      home.dimensionLines = home.dimensionLines.filter((d) => !ids.has(d.id))
      home.labels = home.labels.filter((l) => !ids.has(l.id))
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
  for (const item of [...home.furniture, ...home.labels]) {
    if (ids.has(item.id)) {
      item.x += dx
      item.y += dy
    }
  }
  for (const line of home.dimensionLines) {
    if (ids.has(line.id)) {
      line.xStart += dx
      line.yStart += dy
      line.xEnd += dx
      line.yEnd += dy
    }
  }
}
