import { createContext, useContext } from 'react'

export const NotifyContext = createContext<(message: string) => void>(() => {})

/** Zeigt eine kurze Meldung am unteren Bildschirmrand. */
export function useNotify() {
  return useContext(NotifyContext)
}
