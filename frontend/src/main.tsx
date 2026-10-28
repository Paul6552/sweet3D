import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NotifyProvider } from './editor/notify'
import './i18n'
import './index.css'
import { router } from './router'
import { theme } from './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <NotifyProvider>
        <RouterProvider router={router} />
      </NotifyProvider>
    </ThemeProvider>
  </StrictMode>,
)
