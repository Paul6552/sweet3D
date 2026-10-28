import { newId, type Home, type Level } from './home'

export const DEFAULT_FLOOR_THICKNESS = 12

export function findLevel(home: Home, id: string | null): Level | null {
  return id ? (home.levels.find((l) => l.id === id) ?? null) : null
}

export function selectedLevel(home: Home): Level | null {
  return findLevel(home, home.selectedLevel)
}

/** Höhe des Fußbodens einer Ebene über dem Gelände (0 ohne Ebenen). */
export function levelElevation(home: Home, id: string | null): number {
  return findLevel(home, id)?.elevation ?? 0
}

/** Standardhöhe für Wände ohne eigene Höhe. */
export function defaultWallHeight(home: Home, id: string | null): number {
  return findLevel(home, id)?.height ?? home.wallHeight
}

/**
 * Sicht auf die gewählte Ebene: nur deren Wände, Räume und Möbel. Plan, Möbelliste und
 * Fangfunktionen arbeiten darauf; Befehle beziehen sich über Ids trotzdem auf das ganze Projekt.
 */
export function homeOnLevel(home: Home): Home {
  if (home.levels.length === 0) return home
  const level = home.selectedLevel
  return {
    ...home,
    walls: home.walls.filter((w) => w.level === level),
    rooms: home.rooms.filter((r) => r.level === level),
    furniture: home.furniture.filter((p) => p.level === level),
  }
}

/** Ebene direkt unter der gewählten, im Plan blass zur Orientierung gezeigt. */
export function levelBelow(home: Home): Level | null {
  const current = selectedLevel(home)
  if (!current) return null
  const index = home.levels.indexOf(current)
  return index > 0 ? home.levels[index - 1] : null
}

/** In 3D sichtbare Ebenen: wie in Sweet Home 3D die gewählte und alle darunter. */
export function visibleLevels(home: Home): (Level | null)[] {
  const current = selectedLevel(home)
  if (!current) return [null]
  return home.levels.filter((l) => l.viewable && l.elevation <= current.elevation)
}

export function sortLevels(levels: Level[]): Level[] {
  return levels.map((level, index) => ({ level, index })).sort((a, b) => a.level.elevation - b.level.elevation || a.index - b.index).map(({ level }) => level)
}

/**
 * Neue Ebene über der obersten. Hat das Projekt noch keine Ebenen, entsteht zusätzlich die
 * Ebene 0 für alles Bisherige (wie in Sweet Home 3D).
 */
export function newLevels(home: Home, name: (index: number) => string): { levels: Level[]; base: Level | null } {
  const base: Level | null =
    home.levels.length === 0
      ? { id: newId('level'), name: name(0), elevation: 0, floorThickness: DEFAULT_FLOOR_THICKNESS, height: home.wallHeight, viewable: true }
      : null
  const top = base ?? home.levels[home.levels.length - 1]
  const level: Level = {
    id: newId('level'),
    name: name(home.levels.length + (base ? 1 : 0)),
    elevation: top.elevation + top.height + DEFAULT_FLOOR_THICKNESS,
    floorThickness: DEFAULT_FLOOR_THICKNESS,
    height: top.height,
    viewable: true,
  }
  return { levels: base ? [base, level] : [level], base }
}
