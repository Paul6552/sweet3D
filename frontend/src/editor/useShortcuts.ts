import { useEffect } from 'react'
import { dispatch, executeCommand, useEditorStore } from '../store/editorStore'

/** Tastenkürzel für Undo/Redo und Löschen; in jedem Fenster aktiv. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault()
        dispatch({ type: 'undo' })
      } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault()
        dispatch({ type: 'redo' })
      } else if (key === 'delete' || key === 'backspace') {
        const { selection } = useEditorStore.getState()
        if (selection.length > 0) {
          event.preventDefault()
          executeCommand({ type: 'deleteItems', ids: selection })
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
