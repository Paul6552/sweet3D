import { isAxiosError } from 'axios'
import { useEffect, useRef, useState } from 'react'
import { projectsApi } from '../api/projects'
import { keycloak } from '../auth/keycloak'
import type { Home } from '../model/home'
import { useEditorStore } from '../store/editorStore'

export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict'

const DEBOUNCE_MS = 1500

/**
 * Speichert Änderungen am Projekt verzögert. Die Versionsnummer schützt davor,
 * einen zwischenzeitlich anderswo gespeicherten Stand zu überschreiben (HTTP 409).
 */
export function useAutosave(projectId: string, initialVersion: number | null): SaveState {
  const [state, setState] = useState<SaveState>('saved')
  const version = useRef(initialVersion)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Home | null>(null)

  useEffect(() => {
    version.current = initialVersion
  }, [initialVersion])

  useEffect(() => {
    if (initialVersion === null) return

    const save = async () => {
      const home = pending.current
      if (!home || version.current === null) return
      pending.current = null
      setState('saving')
      try {
        const saved = await projectsApi.update(projectId, { home, version: version.current })
        version.current = saved.version
        setState(pending.current ? 'pending' : 'saved')
      } catch (error) {
        setState(isAxiosError(error) && error.response?.status === 409 ? 'conflict' : 'error')
      }
    }

    const unsubscribe = useEditorStore.subscribe((current, previous) => {
      if (!current.home || !previous.home || current.home === previous.home) return
      pending.current = current.home
      setState((s) => (s === 'conflict' ? s : 'pending'))
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void save(), DEBOUNCE_MS)
    })

    // Beim Schließen des Tabs den letzten Stand noch absenden
    const flush = () => {
      if (!pending.current || version.current === null || !keycloak.token) return
      void fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keycloak.token}` },
        body: JSON.stringify({ home: pending.current, version: version.current }),
      })
    }
    window.addEventListener('pagehide', flush)

    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', flush)
      window.clearTimeout(timer.current)
      void save()
    }
  }, [projectId, initialVersion])

  return state
}
