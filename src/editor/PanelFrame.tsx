import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

interface PanelFrameProps {
  title: string
  icon: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** Rahmen eines Panels mit Titelleiste; der Inhalt füllt den restlichen Platz. */
export function PanelFrame({ title, icon, actions, children }: PanelFrameProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: 'background.paper' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          minHeight: 36,
          borderBottom: 1,
          borderColor: 'divider',
          color: 'text.secondary',
        }}
      >
        {icon}
        <Typography variant="subtitle2" sx={{ flex: 1, color: 'text.primary' }} noWrap>
          {title}
        </Typography>
        {actions}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>{children}</Box>
    </Box>
  )
}
