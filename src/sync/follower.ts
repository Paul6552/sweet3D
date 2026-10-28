import { applyPatches, enablePatches } from 'immer'
import { useEditorStore } from '../store/editorStore'
import type { PanelId } from '../editor/panelIds'
import { channelName, leaderLockName, type SyncMessage } from './protocol'

enablePatches()

/**
 * Verbindet ein herausgelöstes Panel-Fenster mit dem Editor-Hauptfenster. Der Zustand wird
 * per Snapshot übernommen und danach über Patches aktuell gehalten; Aktionen gehen an den Leader.
 */
export function startFollower(projectId: string, leaderId: string, panel: PanelId) {
  const channel = new BroadcastChannel(channelName(projectId, leaderId))
  const windowId = crypto.randomUUID()
  const post = (message: SyncMessage) => channel.postMessage(message)
  const abort = new AbortController()
  let watching = false

  /**
   * Wartet auf den Lock des Leaders. Er wird erst frei, wenn das Hauptfenster geschlossen,
   * neu geladen oder abgestürzt ist. Erst nach dem Snapshot starten, dann hält der Leader ihn sicher.
   */
  const watchLeader = () => {
    if (watching) return
    watching = true
    navigator.locks
      .request(leaderLockName(projectId, leaderId), { signal: abort.signal }, () => {
        watching = false
        useEditorStore.setState({ connection: 'lost' })
      })
      .catch(() => { watching = false })
  }

  const reconnect = () => {
    if (useEditorStore.getState().connection === 'lost') {
      // Hauptfenster wurde neu geladen: neuen Snapshot anfordern
      useEditorStore.setState({ connection: 'connecting' })
      post({ type: 'hello', windowId, panel })
    }
  }

  channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const message = event.data
    switch (message.type) {
      case 'snapshot':
        if (message.to !== windowId) return
        watchLeader()
        useEditorStore.setState({
          home: message.home,
          selection: message.selection,
          canUndo: message.canUndo,
          canRedo: message.canRedo,
          connection: 'connected',
        })
        break
      case 'patches': {
        const { home } = useEditorStore.getState()
        if (home) {
          useEditorStore.setState({
            home: applyPatches(home, message.patches),
            canUndo: message.canUndo,
            canRedo: message.canRedo,
          })
        }
        break
      }
      case 'selection':
        useEditorStore.setState({ selection: message.ids })
        break
      case 'leader-ready':
        reconnect()
        break
      case 'dock':
        if (message.panel === panel) window.close()
        break
      case 'leader-gone':
        useEditorStore.setState({ connection: 'lost' })
        break
    }
  }

  useEditorStore.setState({
    connection: 'connecting',
    dispatch: (action) => post({ type: 'action', action }),
  })
  post({ type: 'hello', windowId, panel })

  const onPageHide = () => post({ type: 'bye', windowId, panel })
  window.addEventListener('pagehide', onPageHide)

  return {
    stop: () => {
      abort.abort()
      window.removeEventListener('pagehide', onPageHide)
      channel.close()
    },
  }
}
