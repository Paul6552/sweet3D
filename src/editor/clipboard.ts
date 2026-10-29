import type { HomeCommand } from '../model/commands'
import { newId, type DimensionLine, type Home, type HomePiece, type Label, type Room, type Wall } from '../model/home'

const CLIPBOARD_KEY = 'sweet3d.clipboard'
const PASTE_OFFSET = 20

interface ClipboardContent {
  walls: Wall[]
  rooms: Room[]
  furniture: HomePiece[]
  dimensionLines?: DimensionLine[]
  labels?: Label[]
}

/** Kopiert die ausgewählten Objekte; über localStorage auch zwischen Fenstern und Projekten. */
export function copySelection(home: Home, selection: string[]): void {
  const ids = new Set(selection)
  const content: ClipboardContent = {
    walls: home.walls.filter((w) => ids.has(w.id)),
    rooms: home.rooms.filter((r) => ids.has(r.id)),
    furniture: home.furniture.filter((p) => ids.has(p.id)),
    dimensionLines: home.dimensionLines.filter((d) => ids.has(d.id)),
    labels: home.labels.filter((l) => ids.has(l.id)),
  }
  try {
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(content))
  } catch {
    // Ohne Speicher kein Kopieren
  }
}

/**
 * Befehl zum Einfügen mit neuen Ids und leichtem Versatz; Verbindungen zwischen
 * mitkopierten Wänden bleiben erhalten, solche zu nicht kopierten Wänden entfallen.
 */
export function pasteCommand(): { command: HomeCommand; ids: string[] } | null {
  let content: ClipboardContent | null = null
  try {
    content = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? 'null') as ClipboardContent | null
  } catch {
    return null
  }
  const dimensionLines = (content?.dimensionLines ?? []).map((d) => ({
    ...d,
    id: newId('dimension'),
    xStart: d.xStart + PASTE_OFFSET,
    yStart: d.yStart + PASTE_OFFSET,
    xEnd: d.xEnd + PASTE_OFFSET,
    yEnd: d.yEnd + PASTE_OFFSET,
  }))
  const labels = (content?.labels ?? []).map((l) => ({ ...l, id: newId('label'), x: l.x + PASTE_OFFSET, y: l.y + PASTE_OFFSET }))
  if (!content || content.walls.length + content.rooms.length + content.furniture.length + dimensionLines.length + labels.length === 0) return null
  const wallIds = new Map(content.walls.map((w) => [w.id, newId('wall')]))
  const walls = content.walls.map((w) => ({
    ...w,
    id: wallIds.get(w.id)!,
    xStart: w.xStart + PASTE_OFFSET,
    yStart: w.yStart + PASTE_OFFSET,
    xEnd: w.xEnd + PASTE_OFFSET,
    yEnd: w.yEnd + PASTE_OFFSET,
    wallAtStart: (w.wallAtStart && wallIds.get(w.wallAtStart)) ?? null,
    wallAtEnd: (w.wallAtEnd && wallIds.get(w.wallAtEnd)) ?? null,
  }))
  const rooms = content.rooms.map((r) => ({
    ...r,
    id: newId('room'),
    points: r.points.map(([x, y]) => [x + PASTE_OFFSET, y + PASTE_OFFSET] as [number, number]),
  }))
  const furniture = content.furniture.map((p) => ({ ...p, id: newId('piece'), x: p.x + PASTE_OFFSET, y: p.y + PASTE_OFFSET }))
  return {
    command: { type: 'addItems', walls, rooms, furniture, dimensionLines, labels },
    ids: [...walls, ...rooms, ...furniture, ...dimensionLines, ...labels].map((i) => i.id),
  }
}
