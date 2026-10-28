import { createEmptyHome, normalizeHome, type Home } from '../model/home'

/**
 * Projekte im localStorage des Browsers: ein Index mit Namen und Zeitstempeln und je Projekt
 * ein Eintrag mit dem Inhalt. Der localStorage fasst je nach Browser etwa 5 MB.
 */
export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

const INDEX_KEY = 'sweet3d:projects'
const LAST_KEY = 'sweet3d:last-project'
const homeKey = (id: string) => `sweet3d:project:${id}`

function readIndex(): ProjectSummary[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as ProjectSummary[]) : []
  } catch {
    return []
  }
}

function writeIndex(index: ProjectSummary[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

function updateSummary(id: string, change: Partial<ProjectSummary>) {
  writeIndex(readIndex().map((p) => (p.id === id ? { ...p, ...change } : p)))
}

/** Alle Projekte, zuletzt geänderte zuerst. */
export function listProjects(): ProjectSummary[] {
  return readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getProject(id: string): { summary: ProjectSummary; home: Home } | null {
  const summary = readIndex().find((p) => p.id === id)
  const raw = localStorage.getItem(homeKey(id))
  if (!summary || raw === null) return null
  return { summary, home: normalizeHome(JSON.parse(raw)) }
}

/** Legt ein Projekt an. Wirft bei vollem Speicher (QuotaExceededError), ohne etwas anzulegen. */
export function createProject(name: string, home: Home = createEmptyHome()): ProjectSummary {
  const now = new Date().toISOString()
  const summary: ProjectSummary = { id: crypto.randomUUID(), name: uniqueName(name), createdAt: now, updatedAt: now }
  localStorage.setItem(homeKey(summary.id), JSON.stringify(home))
  try {
    writeIndex([...readIndex(), summary])
  } catch (error) {
    localStorage.removeItem(homeKey(summary.id))
    throw error
  }
  return summary
}

/** Speichert den Inhalt eines Projekts. Wirft bei vollem Speicher (QuotaExceededError). */
export function saveHome(id: string, home: Home) {
  // Ein inzwischen gelöschtes Projekt nicht durch verzögertes Speichern wieder anlegen
  if (!readIndex().some((p) => p.id === id)) return
  localStorage.setItem(homeKey(id), JSON.stringify(home))
  updateSummary(id, { updatedAt: new Date().toISOString() })
}

export function renameProject(id: string, name: string) {
  updateSummary(id, { name: name.trim() })
}

export function duplicateProject(id: string, name: string): ProjectSummary | null {
  const project = getProject(id)
  return project ? createProject(name, project.home) : null
}

export function deleteProject(id: string) {
  localStorage.removeItem(homeKey(id))
  writeIndex(readIndex().filter((p) => p.id !== id))
  if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY)
}

export function lastProjectId(): string | null {
  const id = localStorage.getItem(LAST_KEY)
  return id && readIndex().some((p) => p.id === id) ? id : null
}

export function setLastProject(id: string) {
  localStorage.setItem(LAST_KEY, id)
}

/** Hängt bei Namensgleichheit eine Nummer an: „Neues Projekt 2“. */
export function uniqueName(name: string): string {
  const base = name.trim() || 'Sweet3D'
  const names = new Set(readIndex().map((p) => p.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** Belegter Speicher aller Sweet3D-Einträge in Zeichen (UTF-16), grob als Byte-Angabe nutzbar. */
export function usedStorage(): number {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('sweet3d:')) total += key.length + (localStorage.getItem(key)?.length ?? 0)
  }
  return total
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
}
