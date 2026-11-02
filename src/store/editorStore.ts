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
  /** Ebene im Plan wechseln; wie die Kamera ohne Undo-Schritt. */
  | { type: 'selectLevel'; id: string }
  | { type: 'camera'; camera: Partial<Omit<Home['camera'], 'observer'>> & { observer?: Partial<Home['camera']['observer']> } }
  /** Locks (or unlocks) model edits while photo renderings of window {@code owner} are pending. */
  | { type: 'renderLock'; owner: string; locked: boolean }

export type ConnectionState = 'connecting' | 'connected' | 'lost'

interface EditorState {
  home: Home | null
  selection: string[]
  canUndo: boolean
  canRedo: boolean
  connection: ConnectionState
  /** Model edits are blocked while photo renderings are pending (see renderQueue). */
  renderLocked: boolean
  /** Counts edits rejected because of {@link renderLocked}, so the UI can show a notice. */
  lockRejections: number
  /** Wird von leader.ts bzw. follower.ts gesetzt. */
  dispatch: (action: EditorAction) => void
}

export const useEditorStore = create<EditorState>(() => ({
  home: null,
  selection: [],
  canUndo: false,
  canRedo: false,
  connection: 'connecting',
  renderLocked: false,
  lockRejections: 0,
  dispatch: () => {},
}))

/** Actions that change the model and are therefore blocked while renderings are pending. */
export function isModelEdit(action: EditorAction): boolean {
  return action.type === 'command' || action.type === 'undo' || action.type === 'redo'
}

export function dispatch(action: EditorAction): void {
  const state = useEditorStore.getState()
  if (state.renderLocked && isModelEdit(action)) {
    useEditorStore.setState({ lockRejections: state.lockRejections + 1 })
    return
  }
  state.dispatch(action)
}

export function executeCommand(command: HomeCommand): void {
  dispatch({ type: 'command', command })
}
