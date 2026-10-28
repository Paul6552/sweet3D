/**
 * Datenmodell eines Projekts. Felder und Einheiten folgen com.eteks.sweethome3d.model
 * (Längen in cm, Winkel in Radiant), damit der Import/Export von .sh3d-Dateien 1:1 möglich ist.
 */

export interface Wall {
  id: string
  xStart: number
  yStart: number
  xEnd: number
  yEnd: number
  /** Id der Wand, die am Startpunkt anschließt. */
  wallAtStart: string | null
  /** Id der Wand, die am Endpunkt anschließt. */
  wallAtEnd: string | null
  thickness: number
  /** Höhe in cm; {@code null} bedeutet Standardhöhe des Projekts. */
  height: number | null
}

export interface Room {
  id: string
  name: string | null
  points: [number, number][]
  floorVisible: boolean
  ceilingVisible: boolean
}

export interface HomePiece {
  id: string
  /** Id des Katalogeintrags, aus dem das Möbel erzeugt wurde. */
  catalogId: string | null
  name: string
  /** Mittelpunkt im Plan. */
  x: number
  y: number
  elevation: number
  angle: number
  width: number
  depth: number
  height: number
  visible: boolean
  model: string | null
  modelRotation: number[][] | null
  icon: string | null
  planIcon: string | null
  doorOrWindow: boolean
  color: number | null
}

export interface Home {
  formatVersion: 1
  wallHeight: number
  walls: Wall[]
  rooms: Room[]
  furniture: HomePiece[]
}

export function createEmptyHome(): Home {
  return { formatVersion: 1, wallHeight: 250, walls: [], rooms: [], furniture: [] }
}

/** Ergänzt fehlende Felder (z. B. bei neuen, noch leeren Projekten aus dem Backend). */
export function normalizeHome(raw: unknown): Home {
  const home = (raw && typeof raw === 'object' ? raw : {}) as Partial<Home>
  const empty = createEmptyHome()
  return {
    formatVersion: 1,
    wallHeight: home.wallHeight ?? empty.wallHeight,
    walls: home.walls ?? [],
    rooms: home.rooms ?? [],
    furniture: home.furniture ?? [],
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}
