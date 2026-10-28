import { create } from 'zustand'
import type { PanelId } from './panelIds'
import type { Leader } from '../sync/leader'
import { saveDetachedPanels } from '../sync/windows'

interface LayoutState {
  /** Panels, die gerade in einem eigenen Fenster angezeigt werden. */
  detached: PanelId[]
  /** Leader dieses Editor-Hauptfensters, sobald das Projekt geladen ist. */
  leader: Leader | null
  setLeader: (leader: Leader | null) => void
  setDetached: (panel: PanelId, detached: boolean) => void
  /** Beim Verlassen des Editors; der gemerkte Stand für „Fenster wiederherstellen“ bleibt erhalten. */
  reset: () => void
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  detached: [],
  leader: null,
  setLeader: (leader) => set({ leader }),
  setDetached: (panel, detached) => {
    const current = get().detached
    if (current.includes(panel) === detached) return
    const next = detached ? [...current, panel] : current.filter((p) => p !== panel)
    saveDetachedPanels(next)
    set({ detached: next })
  },
  reset: () => set({ detached: [] }),
}))
