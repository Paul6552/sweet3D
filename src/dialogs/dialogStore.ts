import { create } from 'zustand'

export type DialogRequest =
  /** Eigenschaften der Objekte mit diesen Ids ändern. */
  | { kind: 'edit'; ids: string[] }
  /** Neuen Text an dieser Stelle im Plan anlegen. */
  | { kind: 'newLabel'; x: number; y: number }
  /** Kompass und Lage des Projekts. */
  | { kind: 'compass' }

interface DialogState {
  request: DialogRequest | null
  open: (request: DialogRequest) => void
  close: () => void
}

/** Offener Dialog des jeweiligen Fensters (Plan, Möbelliste und 3D-Ansicht können ihn anfordern). */
export const useDialogStore = create<DialogState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}))

export const openCompassDialog = () => useDialogStore.getState().open({ kind: 'compass' })

export const openItemDialog = (ids: string[]) => ids.length > 0 && useDialogStore.getState().open({ kind: 'edit', ids })

/** Solange ein Dialog offen ist, gehören die Tasten ihm (keine Werkzeug- oder Löschkürzel). */
export const isDialogOpen = () => document.querySelector('.MuiDialog-root') !== null
