import { useEffect, useState } from 'react'
import type { Home } from '../model/home'
import { saveHome } from '../storage/projects'
import { useEditorStore } from '../store/editorStore'

export type SaveState = 'saved' | 'pending' | 'error'

const DEBOUNCE_MS = 300

/**
 * Speichert Änderungen am Projekt verzögert in IndexedDB. Spätestens beim Verbergen oder Schließen
 * des Tabs wird gespeichert, da IndexedDB asynchron schreibt.
 */
export function useAutosave(projectId: string | null): SaveState {
  const [state, setState] = useState<SaveState>('saved')

  useEffect(() => {
    if (!projectId) return
    let pending: Home | null = null
    let timer: number | undefined

    const save = () => {
      window.clearTimeout(timer)
      const home = pending
      if (!home) return
      pending = null
      saveHome(projectId, home).then(
        () => {
          if (!pending) setState('saved')
        },
        (error: unknown) => {
          console.error('Speichern fehlgeschlagen', error)
          // Stand für den nächsten Versuch vormerken, sofern es keinen neueren gibt
          pending ??= home
          setState('error')
        },
      )
    }

    const unsubscribe = useEditorStore.subscribe((current, previous) => {
      if (!current.home || !previous.home || current.home === previous.home) return
      pending = current.home
      setState((s) => (s === 'error' ? s : 'pending'))
      window.clearTimeout(timer)
      timer = window.setTimeout(save, DEBOUNCE_MS)
    })
    const onHide = () => {
      if (document.visibilityState === 'hidden') save()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)

    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [projectId])

  return state
}
