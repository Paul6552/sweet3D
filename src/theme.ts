import { createTheme } from '@mui/material/styles'
import '@fontsource-variable/inter'

export const theme = createTheme({
  colorSchemes: { light: true, dark: true },
  typography: {
    fontFamily: '"Inter Variable", "Inter", system-ui, sans-serif',
  },
  shape: { borderRadius: 8 },
})
