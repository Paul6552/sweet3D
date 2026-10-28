import type { PanelId } from '../editor/panelIds'

/** Fensterposition in Bildschirmkoordinaten (über alle Monitore). */
export interface Placement {
  left: number
  top: number
  width: number
  height: number
}

const PLACEMENT_KEY = 'sweet3d.placement.'
const DETACHED_KEY = 'sweet3d.detached'
const LEADER_KEY = 'sweet3d.leader.'

const openWindows = new Map<PanelId, Window>()

function readJson<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Speicher nicht verfügbar: Layout wird dann nur nicht gemerkt
  }
}

/**
 * Kennung dieses Editor-Tabs. Sie bleibt beim Neuladen erhalten (sessionStorage), damit
 * offene Panel-Fenster sich wieder mit dem neu geladenen Hauptfenster verbinden.
 */
export function leaderIdFor(projectId: string): string {
  const key = LEADER_KEY + projectId
  let id: string | null = null
  try {
    id = sessionStorage.getItem(key)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(key, id)
    }
  } catch {
    id ??= crypto.randomUUID()
  }
  return id
}

export function loadPlacement(panel: PanelId): Placement | null {
  return readJson<Placement>(PLACEMENT_KEY + panel)
}

/** Merkt sich die aktuelle Position dieses (Panel-)Fensters. */
export function saveOwnPlacement(panel: PanelId): void {
  writeJson(PLACEMENT_KEY + panel, {
    left: window.screenX,
    top: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight,
  } satisfies Placement)
}

export function loadDetachedPanels(): PanelId[] {
  return readJson<PanelId[]>(DETACHED_KEY) ?? []
}

export function saveDetachedPanels(panels: PanelId[]): void {
  writeJson(DETACHED_KEY, panels)
}

/** Platzierung, die ein Fenster mittig und groß auf dem gewählten Bildschirm öffnet. */
export function placementOnScreen(screen: ScreenDetailed): Placement {
  const width = Math.round(screen.availWidth * 0.9)
  const height = Math.round(screen.availHeight * 0.9)
  return {
    left: screen.availLeft + Math.round((screen.availWidth - width) / 2),
    top: screen.availTop + Math.round((screen.availHeight - height) / 2),
    width,
    height,
  }
}

/**
 * Fragt die angeschlossenen Bildschirme ab (Window Management API, nur Chrome/Edge).
 * Liefert {@code null}, wenn die API fehlt oder die Berechtigung verweigert wurde.
 */
export async function requestScreenDetails(): Promise<ScreenDetails | null> {
  if (!window.getScreenDetails) return null
  try {
    return await window.getScreenDetails()
  } catch {
    return null
  }
}

/**
 * Öffnet ein Panel in einem eigenen Fenster. Muss direkt aus einem Klick heraus aufgerufen
 * werden, sonst blockiert der Browser das Pop-up. Liefert {@code false}, wenn es blockiert wurde.
 */
export function openPanelWindow(url: string, panel: PanelId, placement: Placement | null): boolean {
  const existing = openWindows.get(panel)
  if (existing && !existing.closed) {
    existing.focus()
    return true
  }
  const p = placement ?? loadPlacement(panel)
  const features = p
    ? `popup,left=${p.left},top=${p.top},width=${p.width},height=${p.height}`
    : 'popup,width=1200,height=800'
  const win = window.open(url, `sweet3d-${panel}`, features)
  if (!win) return false
  openWindows.set(panel, win)
  return true
}

export function focusPanelWindow(panel: PanelId): boolean {
  const win = openWindows.get(panel)
  if (win && !win.closed) {
    win.focus()
    return true
  }
  return false
}

/** Panels, deren Fenster dieses Tab geöffnet hat und die inzwischen geschlossen wurden. */
export function closedPanelWindows(): PanelId[] {
  const closed: PanelId[] = []
  for (const [panel, win] of openWindows) {
    if (win.closed) {
      openWindows.delete(panel)
      closed.push(panel)
    }
  }
  return closed
}
