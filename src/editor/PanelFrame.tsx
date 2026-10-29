import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PanelFrameProps {
  title: string
  icon: ReactNode
  actions?: ReactNode
  children: ReactNode
}

const ToolbarSlot = createContext<HTMLElement | null>(null)

/** Rahmen eines Panels mit Titelleiste; der Inhalt füllt den restlichen Platz. */
export function PanelFrame({ title, icon, actions, children }: PanelFrameProps) {
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
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
        <Typography variant="subtitle2" sx={{ flexShrink: 0, color: 'text.primary' }} noWrap>
          {title}
        </Typography>
        {/* Werkzeugleiste des Panels (siehe PanelToolbar); bricht um, wenn der Platz nicht reicht */}
        <Box
          ref={setToolbarSlot}
          sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, py: 0.25, color: 'text.primary' }}
        />
        {actions}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <ToolbarSlot.Provider value={toolbarSlot}>{children}</ToolbarSlot.Provider>
      </Box>
    </Box>
  )
}

/** Zeigt die Werkzeugleiste eines Panels in dessen Titelleiste statt in einer eigenen Zeile. */
export function PanelToolbar({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlot)
  return slot ? createPortal(children, slot) : null
}
