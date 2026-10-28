import { applyPatches, enablePatches } from 'immer'
import { useEditorStore } from '../store/editorStore'
import type { PanelId } from '../editor/panelIds'
import { channelName, PING_TIMEOUT_MS, type SyncMessage } from './protocol'

enablePatches()

/**
 * Verbindet ein herausgelöstes Panel-Fenster mit dem Editor-Hauptfenster. Der Zustand wird
 * per Snapshot übernommen und danach über Patches aktuell gehalten; Aktionen gehen an den Leader.
 */
export function startFollower(projectId: string, leaderId: string, panel: PanelId) {
  const channel = new BroadcastChannel(channelName(projectId, leaderId))
  const windowId = crypto.randomUUID()
  const post = (message: SyncMessage) => channel.postMessage(message)
  let lastSeen = Date.now()

  const markAlive = () => {
    lastSeen = Date.now()
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
        lastSeen = Date.now()
        useEditorStore.setState({
          home: message.home,
          selection: message.selection,
          canUndo: message.canUndo,
          canRedo: message.canRedo,
          connection: 'connected',
        })
        break
      case 'patches': {
        markAlive()
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
        markAlive()
        useEditorStore.setState({ selection: message.ids })
        break
      case 'ping':
        markAlive()
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

  const watchdog = window.setInterval(() => {
    if (Date.now() - lastSeen > PING_TIMEOUT_MS) {
      useEditorStore.setState({ connection: 'lost' })
    }
  }, 1000)
  const onPageHide = () => post({ type: 'bye', windowId, panel })
  window.addEventListener('pagehide', onPageHide)

  return {
    stop: () => {
      window.clearInterval(watchdog)
      window.removeEventListener('pagehide', onPageHide)
      channel.close()
    },
  }
}
