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

/**
 * Traufhöhe von Dächern ohne eigene Angabe: auf dem Dach-Niveau dessen Fußboden (die Oberkante der
 * Wände darunter samt Decke), sonst die Wandhöhe der Ebene.
 */
export function defaultEaveHeight(home: Pick<Home, 'levels' | 'wallHeight'>, id: string | null): number {
  const level = findLevel(home as Home, id)
  return level?.roof ? 0 : (level?.height ?? home.wallHeight)
}

/** Das Dach-Niveau des Projekts, falls angelegt. */
export function roofLevel(home: Pick<Home, 'levels'>): Level | null {
  return home.levels.find((l) => l.roof) ?? null
}

/** Standardhöhe für Wände ohne eigene Höhe. */
export function defaultWallHeight(home: Home, id: string | null): number {
  return findLevel(home, id)?.height ?? home.wallHeight
}

/** Objekte einer Ebene; {@code undefined} heißt: Projekt ohne Ebenen, alles gehört dazu. */
export function onLevel<T extends { level: string | null }>(items: T[], level: string | null | undefined): T[] {
  return level === undefined ? items : items.filter((i) => i.level === level)
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
    roofs: home.roofs.filter((r) => r.level === level),
    furniture: home.furniture.filter((p) => p.level === level),
    dimensionLines: home.dimensionLines.filter((d) => d.level === level),
    labels: home.labels.filter((l) => l.level === level),
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

/**
 * Sichtbare Ebenen über der gewählten: in 3D ausgeblendet, damit man von oben hineinsieht,
 * aber ihre Decken und Wände werfen weiter Schatten.
 */
export function levelsAbove(home: Home): Level[] {
  const current = selectedLevel(home)
  if (!current) return []
  return home.levels.filter((l) => l.viewable && l.elevation > current.elevation)
}

export function sortLevels(levels: Level[]): Level[] {
  return levels.map((level, index) => ({ level, index })).sort((a, b) => a.level.elevation - b.level.elevation || a.index - b.index).map(({ level }) => level)
}

/**
 * Neue Ebene über der obersten, aber unter dem Dach-Niveau (das {@link settleRoofLevel} danach
 * nach oben rückt). Hat das Projekt noch keine Ebenen, entsteht zusätzlich die Ebene 0 für alles
 * Bisherige (wie in Sweet Home 3D).
 */
export function newLevels(home: Home, name: (index: number) => string): { levels: Level[]; base: Level | null } {
  const base: Level | null =
    home.levels.length === 0
      ? { id: newId('level'), name: name(0), elevation: 0, floorThickness: DEFAULT_FLOOR_THICKNESS, height: home.wallHeight, viewable: true }
      : null
  const storeys = home.levels.filter((l) => !l.roof)
  const top = base ?? storeys[storeys.length - 1] ?? home.levels[home.levels.length - 1]
  const level: Level = {
    id: newId('level'),
    name: name(storeys.length + (base ? 1 : 0)),
    elevation: top.elevation + top.height + DEFAULT_FLOOR_THICKNESS,
    floorThickness: DEFAULT_FLOOR_THICKNESS,
    height: top.height,
    viewable: true,
  }
  return { levels: base ? [base, level] : [level], base }
}

/** Legt das Dach-Niveau auf das oberste Geschoss (nach neuen, gelöschten oder geänderten Ebenen). */
export function settleRoofLevel(levels: Level[]): void {
  const roof = levels.find((l) => l.roof)
  const top = sortLevels(levels.filter((l) => !l.roof)).at(-1)
  if (roof && top) roof.elevation = top.elevation + top.height + roof.floorThickness
}

/** Neues Dach-Niveau über dem obersten (mit Ebene 0, falls das Projekt noch keine Ebenen hat). */
export function newRoofLevel(home: Home, name: string, baseName: string): { levels: Level[]; base: Level | null } {
  const { levels, base } = newLevels(home, () => baseName)
  const roof = levels[levels.length - 1]
  return { levels: [...levels.slice(0, -1), { ...roof, name, roof: true }], base }
}
