import type { Patch } from 'immer'
import type { Home } from '../model/home'
import type { EditorAction } from '../store/editorStore'
import type { PanelId } from '../editor/panelIds'

/**
 * Nachrichten zwischen dem Editor-Hauptfenster (Leader) und herausgelösten Panel-Fenstern
 * (Follower). Der Kanal ist pro Editor-Tab eindeutig, siehe {@link channelName}.
 */
export type SyncMessage =
  | { type: 'hello'; windowId: string; panel: PanelId }
  | { type: 'bye'; windowId: string; panel: PanelId }
  | { type: 'snapshot'; to: string; home: Home; selection: string[]; canUndo: boolean; canRedo: boolean }
  | { type: 'patches'; patches: Patch[]; canUndo: boolean; canRedo: boolean }
  | { type: 'selection'; ids: string[] }
  | { type: 'action'; action: EditorAction }
  | { type: 'dock'; panel: PanelId }
  | { type: 'ping' }
  | { type: 'leader-gone' }

export const PING_INTERVAL_MS = 2000
export const PING_TIMEOUT_MS = 6000

export function channelName(projectId: string, leaderId: string): string {
  return `sweet3d:${projectId}:${leaderId}`
}
