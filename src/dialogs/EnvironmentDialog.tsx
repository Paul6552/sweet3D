import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import SatelliteAltOutlined from '@mui/icons-material/SatelliteAltOutlined'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Surface } from '../model/home'
import { executeCommand, useEditorStore } from '../store/editorStore'
import { openBackgroundImageDialog } from './dialogStore'
import { SurfaceEditor } from './SurfaceEditor'

/** Ground of the 3D view like "Modify 3D view" in Sweet Home 3D: default lawn, color or texture. */
export function EnvironmentDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const initial = useEditorStore((s) => s.home?.environment.ground)
  const backgroundImage = useEditorStore((s) => s.home?.environment.backgroundImage ?? null)
  const imageOnGround = useEditorStore((s) => s.home?.environment.backgroundImageOnGround ?? false)
  const [ground, setGround] = useState<Surface>(() => initial ?? { color: null, texture: null })

  const apply = () => {
    if (JSON.stringify(ground) !== JSON.stringify(initial)) executeCommand({ type: 'updateEnvironment', change: { ground } })
  }
  const save = () => {
    apply()
    onClose()
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <DialogTitle>{t('environment.title')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SurfaceEditor label={t('environment.ground')} value={ground} onChange={setGround} textures />
          <DialogContentText variant="body2">{t('environment.groundHint')}</DialogContentText>
          <Typography variant="subtitle2">{t('backgroundImage.title')}</Typography>
          <DialogContentText variant="body2">
            {t(!backgroundImage ? 'environment.aerialNone' : imageOnGround ? 'environment.aerialOnGround' : 'environment.aerialPlanOnly')}
          </DialogContentText>
          <Button
            variant="outlined"
            startIcon={<SatelliteAltOutlined />}
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => {
              // Keeps the chosen ground, the background image dialog replaces this one
              apply()
              openBackgroundImageDialog()
            }}
          >
            {t(backgroundImage ? 'backgroundImage.edit' : 'backgroundImage.import')}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('projects.cancel')}</Button>
          <Button type="submit" variant="contained">
            {t('dialogs.ok')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
