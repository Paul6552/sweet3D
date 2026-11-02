import { create } from 'zustand'

export type DialogRequest =
  /** Eigenschaften der Objekte mit diesen Ids ändern. */
  | { kind: 'edit'; ids: string[] }
  /** Neuen Text an dieser Stelle im Plan anlegen. */
  | { kind: 'newLabel'; x: number; y: number }
  /** Kompass und Lage des Projekts. */
  | { kind: 'compass' }
  /** Ground of the 3D view. */
  | { kind: 'environment' }
  /** Background image of the plan, also usable as 3D ground. */
  | { kind: 'backgroundImage' }

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

export const openEnvironmentDialog = () => useDialogStore.getState().open({ kind: 'environment' })

export const openBackgroundImageDialog = () => useDialogStore.getState().open({ kind: 'backgroundImage' })

export const openCompassDialog = () => useDialogStore.getState().open({ kind: 'compass' })

export const openItemDialog = (ids: string[]) => ids.length > 0 && useDialogStore.getState().open({ kind: 'edit', ids })

/** Solange ein Dialog offen ist, gehören die Tasten ihm (keine Werkzeug- oder Löschkürzel). */
export const isDialogOpen = () => document.querySelector('.MuiDialog-root') !== null
