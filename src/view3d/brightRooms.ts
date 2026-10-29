import { create } from 'zustand'

const KEY = 'sweet3d.brightRooms'

function initial(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    // Speicher nicht verfügbar
    return false
  }
}

interface BrightRoomsState {
  /** Räume immer hell: Himmelslicht auch in geschlossenen Räumen, z. B. zum Möblieren. */
  brightRooms: boolean
  setBrightRooms: (brightRooms: boolean) => void
}

/** Ansichtseinstellung der 3D-Ansicht, je Browser gemerkt (nicht im Projekt). */
export const useBrightRoomsStore = create<BrightRoomsState>((set) => ({
  brightRooms: initial(),
  setBrightRooms: (brightRooms) => {
    try {
      localStorage.setItem(KEY, String(brightRooms))
    } catch {
      // Speicher nicht verfügbar: gilt dann nur in diesem Fenster
    }
    set({ brightRooms })
  },
}))
