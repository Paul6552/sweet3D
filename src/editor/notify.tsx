import Snackbar from '@mui/material/Snackbar'
import { useCallback, useState, type ReactNode } from 'react'
import { NotifyContext } from './useNotify'

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const notify = useCallback((text: string) => setMessage(text), [])
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        open={message !== null}
        message={message}
        autoHideDuration={6000}
        onClose={() => setMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </NotifyContext.Provider>
  )
}

