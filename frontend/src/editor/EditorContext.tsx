import { createContext, useContext } from 'react'
import type { Leader } from '../sync/leader'

export interface EditorContextValue {
  projectId: string
  leaderId: string
  /** Nur im Editor-Hauptfenster gesetzt. */
  leader: Leader | null
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext)
  if (!context) throw new Error('useEditorContext außerhalb des Editors')
  return context
}

export function panelUrl(projectId: string, leaderId: string, panel: string): string {
  return `/editor/${projectId}/panel/${panel}?leader=${encodeURIComponent(leaderId)}`
}
