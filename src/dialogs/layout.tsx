import Box from '@mui/material/Box'
import type { ReactNode } from 'react'

/** Felder im Raster, Flächen und lange Texte über die ganze Breite. */
export function Grid({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5, alignItems: 'center' }}>{children}</Box>
}
