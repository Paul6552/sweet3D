import { create } from 'zustand'
import type { HomeCommand } from '../model/commands'
import type { Home } from '../model/home'

/** Aktionen, die jedes Fenster auslösen kann; ausgeführt werden sie immer im Editor-Hauptfenster. */
export type EditorAction =
  | { type: 'command'; command: HomeCommand }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; ids: string[] }
  /** Kamera ändern; erzeugt keinen Undo-Schritt, wird aber gespeichert und synchronisiert. */
  | { type: 'camera'; camera: Partial<Omit<Home['camera'], 'observer'>> & { observer?: Partial<Home['camera']['observer']> } }

export type ConnectionState = 'connecting' | 'connected' | 'lost'

interface EditorState {
  home: Home | null
  selection: string[]
  canUndo: boolean
  canRedo: boolean
  connection: ConnectionState
  /** Wird von leader.ts bzw. follower.ts gesetzt. */
  dispatch: (action: EditorAction) => void
}

export const useEditorStore = create<EditorState>(() => ({
  home: null,
  selection: [],
  canUndo: false,
  canRedo: false,
  connection: 'connecting',
  dispatch: () => {},
}))

export function dispatch(action: EditorAction): void {
  useEditorStore.getState().dispatch(action)
}

export function executeCommand(command: HomeCommand): void {
  dispatch({ type: 'command', command })
}
