import { useEffect } from 'react'
import { dispatch, executeCommand, useEditorStore } from '../store/editorStore'
import { copySelection, pasteCommand } from './clipboard'

/** Tastenkürzel für Undo/Redo, Löschen, Kopieren/Ausschneiden/Einfügen und Alles auswählen. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const { home, selection } = useEditorStore.getState()
      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault()
        dispatch({ type: 'undo' })
      } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault()
        dispatch({ type: 'redo' })
      } else if (mod && key === 'a' && home) {
        event.preventDefault()
        dispatch({ type: 'select', ids: [...home.walls, ...home.rooms, ...home.furniture.filter((p) => p.visible)].map((i) => i.id) })
      } else if (mod && (key === 'c' || key === 'x') && home && selection.length > 0) {
        event.preventDefault()
        copySelection(home, selection)
        if (key === 'x') executeCommand({ type: 'deleteItems', ids: selection })
      } else if (mod && key === 'v') {
        const paste = pasteCommand()
        if (paste) {
          event.preventDefault()
          executeCommand(paste.command)
          dispatch({ type: 'select', ids: paste.ids })
        }
      } else if ((key === 'delete' || key === 'backspace') && selection.length > 0) {
        event.preventDefault()
        executeCommand({ type: 'deleteItems', ids: selection })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
