import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initAuth } from './auth/keycloak'
import { NotifyProvider } from './editor/notify'
import './i18n'
import './index.css'
import { router } from './router'
import { theme } from './theme'

const root = createRoot(document.getElementById('root')!)

initAuth().then(
  () =>
    root.render(
      <StrictMode>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <NotifyProvider>
            <RouterProvider router={router} />
          </NotifyProvider>
        </ThemeProvider>
      </StrictMode>,
    ),
  () => root.render(<p style={{ padding: 16 }}>Anmeldung fehlgeschlagen – ist Keycloak (localhost:8190) erreichbar?</p>),
)
