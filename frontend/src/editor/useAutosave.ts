import { useEffect, useState } from 'react'
import type { Home } from '../model/home'
import { saveHome } from '../storage/projects'
import { useEditorStore } from '../store/editorStore'

export type SaveState = 'saved' | 'pending' | 'error'

const DEBOUNCE_MS = 400

/** Speichert Änderungen am Projekt verzögert im localStorage, spätestens beim Schließen des Tabs. */
export function useAutosave(projectId: string | null): SaveState {
  const [state, setState] = useState<SaveState>('saved')

  useEffect(() => {
    if (!projectId) return
    let pending: Home | null = null
    let timer: number | undefined

    const save = () => {
      window.clearTimeout(timer)
      if (!pending) return
      try {
        saveHome(projectId, pending)
        pending = null
        setState('saved')
      } catch (error) {
        // Meist ist der Speicher voll (QuotaExceededError); der Stand bleibt zum nächsten Versuch vorgemerkt
        console.error('Speichern fehlgeschlagen', error)
        setState('error')
      }
    }

    const unsubscribe = useEditorStore.subscribe((current, previous) => {
      if (!current.home || !previous.home || current.home === previous.home) return
      pending = current.home
      setState((s) => (s === 'error' ? s : 'pending'))
      window.clearTimeout(timer)
      timer = window.setTimeout(save, DEBOUNCE_MS)
    })
    window.addEventListener('pagehide', save)

    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [projectId])

  return state
}
