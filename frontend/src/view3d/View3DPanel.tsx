import ViewInArOutlined from '@mui/icons-material/ViewInArOutlined'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useEditorStore } from '../store/editorStore'

/** Platzhalter, bis die 3D-Ansicht (react-three-fiber) in Phase 4 entsteht. */
export function View3DPanel() {
  const { t } = useTranslation()
  const home = useEditorStore((s) => s.home)
  if (!home) return null
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'text.secondary', p: 2 }}>
      <div>
        <ViewInArOutlined sx={{ fontSize: 64, opacity: 0.4 }} />
        <Typography>{t('view3d.placeholder')}</Typography>
        <Typography variant="caption" component="p" data-testid="view3d-stats">
          {t('view3d.stats', { walls: home.walls.length, rooms: home.rooms.length, furniture: home.furniture.length })}
        </Typography>
      </div>
    </Box>
  )
}
