import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer'
import { applyCommand } from '../model/commands'
import type { Home } from '../model/home'
import { useEditorStore, type EditorAction } from '../store/editorStore'
import type { PanelId } from '../editor/panelIds'
import { channelName, leaderLockName, type SyncMessage } from './protocol'

enablePatches()

const MAX_UNDO = 200

interface HistoryEntry {
  patches: Patch[]
  inverse: Patch[]
}

export interface LeaderCallbacks {
  onPanelOpened: (panel: PanelId) => void
  onPanelClosed: (panel: PanelId) => void
}

/**
 * Macht dieses Fenster zum Editor-Hauptfenster: Es führt alle Aktionen aus, hält die
 * Undo-Historie und verteilt Änderungen als immer-Patches an die Panel-Fenster.
 */
export function startLeader(projectId: string, leaderId: string, home: Home, callbacks: LeaderCallbacks) {
  const channel = new BroadcastChannel(channelName(projectId, leaderId))
  const past: HistoryEntry[] = []
  const future: HistoryEntry[] = []
  const post = (message: SyncMessage) => channel.postMessage(message)

  const applyAndBroadcast = (next: Home, patches: Patch[]) => {
    const canUndo = past.length > 0
    const canRedo = future.length > 0
    useEditorStore.setState({ home: next, canUndo, canRedo })
    post({ type: 'patches', patches, canUndo, canRedo })
  }

  const handle = (action: EditorAction) => {
    const state = useEditorStore.getState()
    const home = state.home!
    switch (action.type) {
      case 'command': {
        const [next, patches, inverse] = produceWithPatches(home, (draft) => applyCommand(draft, action.command))
        if (patches.length === 0) return
        past.push({ patches, inverse })
        if (past.length > MAX_UNDO) past.shift()
        future.length = 0
        applyAndBroadcast(next, patches)
        // Gelöschte Objekte aus der Auswahl entfernen
        if (action.command.type === 'deleteItems') {
          const deleted = new Set(action.command.ids)
          handle({ type: 'select', ids: state.selection.filter((id) => !deleted.has(id)) })
        }
        break
      }
      case 'undo': {
        const entry = past.pop()
        if (!entry) return
        future.push(entry)
        applyAndBroadcast(applyPatches(home, entry.inverse), entry.inverse)
        break
      }
      case 'redo': {
        const entry = future.pop()
        if (!entry) return
        past.push(entry)
        applyAndBroadcast(applyPatches(home, entry.patches), entry.patches)
        break
      }
      case 'camera': {
        const [next, patches] = produceWithPatches(home, (draft) => {
          if (action.camera.mode) draft.camera.mode = action.camera.mode
          if (action.camera.time !== undefined) draft.camera.time = action.camera.time
          if (action.camera.observer) Object.assign(draft.camera.observer, action.camera.observer)
        })
        if (patches.length > 0) applyAndBroadcast(next, patches)
        break
      }
      case 'selectLevel': {
        const [next, patches] = produceWithPatches(home, (draft) => {
          if (draft.levels.some((l) => l.id === action.id)) draft.selectedLevel = action.id
        })
        if (patches.length > 0) {
          applyAndBroadcast(next, patches)
          // Auswahl gilt nur auf einer Ebene
          useEditorStore.setState({ selection: [] })
          post({ type: 'selection', ids: [] })
        }
        break
      }
      case 'select':
        useEditorStore.setState({ selection: action.ids })
        post({ type: 'selection', ids: action.ids })
        break
    }
  }

  channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const message = event.data
    switch (message.type) {
      case 'hello': {
        const { home: current, selection, canUndo, canRedo } = useEditorStore.getState()
        post({ type: 'snapshot', to: message.windowId, home: current!, selection, canUndo, canRedo })
        callbacks.onPanelOpened(message.panel)
        break
      }
      case 'bye':
        callbacks.onPanelClosed(message.panel)
        break
      case 'action':
        handle(message.action)
        break
    }
  }

  useEditorStore.setState({
    home,
    selection: [],
    canUndo: false,
    canRedo: false,
    connection: 'connected',
    dispatch: handle,
  })

  let releaseLock = () => {}
  void navigator.locks.request(
    leaderLockName(projectId, leaderId),
    () => new Promise<void>((resolve) => { releaseLock = resolve }),
  )
  // Panel-Fenster, die noch vom vorigen Laden dieser Seite offen sind, verbinden sich neu
  post({ type: 'leader-ready' })
  const onPageHide = () => post({ type: 'leader-gone' })
  window.addEventListener('pagehide', onPageHide)

  return {
    /** Bittet ein herausgelöstes Panel-Fenster, sich zu schließen. */
    dock: (panel: PanelId) => post({ type: 'dock', panel }),
    stop: () => {
      post({ type: 'leader-gone' })
      releaseLock()
      window.removeEventListener('pagehide', onPageHide)
      channel.close()
      useEditorStore.setState({ home: null, dispatch: () => {}, connection: 'connecting' })
    },
  }
}

export type Leader = ReturnType<typeof startLeader>
