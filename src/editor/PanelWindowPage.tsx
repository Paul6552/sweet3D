import CallReceived from '@mui/icons-material/CallReceived'
import Fullscreen from '@mui/icons-material/Fullscreen'
import FullscreenExit from '@mui/icons-material/FullscreenExit'
import Redo from '@mui/icons-material/Redo'
import Undo from '@mui/icons-material/Undo'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useParams, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogHost } from '../dialogs/DialogHost'
import { dispatch, useEditorStore } from '../store/editorStore'
import { startFollower } from '../sync/follower'
import { saveOwnPlacement } from '../sync/windows'
import { EditorContext } from './EditorContext'
import { PanelFrame } from './PanelFrame'
import { isPanelId } from './panelIds'
import { PANELS } from './panels'
import { useShortcuts } from './useShortcuts'

/**
 * Ein herausgelöstes Panel in einem eigenen Browserfenster, z. B. die 3D-Ansicht auf einem
 * zweiten Bildschirm. Der Zustand kommt per BroadcastChannel vom Editor-Hauptfenster.
 */
export function PanelWindowPage() {
  const { t } = useTranslation()
  const { projectId, panelId } = useParams({ from: '/editor/$projectId/panel/$panelId' })
  const { leader: leaderId } = useSearch({ from: '/editor/$projectId/panel/$panelId' })
  const connection = useEditorStore((s) => s.connection)
  const hasHome = useEditorStore((s) => s.home !== null)
  const canUndo = useEditorStore((s) => s.canUndo)
  const canRedo = useEditorStore((s) => s.canRedo)
  const [fullscreen, setFullscreen] = useState(false)
  const panel = isPanelId(panelId) ? panelId : null
  useShortcuts()

  useEffect(() => {
    if (!panel) return
    const follower = startFollower(projectId, leaderId, panel)
    // Position merken, damit das Fenster beim nächsten Mal wieder dort erscheint
    const remember = () => saveOwnPlacement(panel)
    window.addEventListener('pagehide', remember)
    window.addEventListener('resize', remember)
    return () => {
      window.removeEventListener('pagehide', remember)
      window.removeEventListener('resize', remember)
      follower.stop()
    }
  }, [projectId, leaderId, panel])

  useEffect(() => {
    if (panel) document.title = `${t(PANELS[panel].titleKey)} – Sweet3D`
    const onChange = () => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [panel, t])

  if (!panel) return null
  const { titleKey, icon, Component } = PANELS[panel]

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }

  const actions = (
    <>
      <Tooltip title={t('editor.undo')}>
        <span>
          <IconButton size="small" disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} aria-label={t('editor.undo')}>
            <Undo fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('editor.redo')}>
        <span>
          <IconButton size="small" disabled={!canRedo} onClick={() => dispatch({ type: 'redo' })} aria-label={t('editor.redo')}>
            <Redo fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('panels.fullscreen')}>
        <IconButton size="small" onClick={toggleFullscreen} aria-label={t('panels.fullscreen')}>
          {fullscreen ? <FullscreenExit fontSize="small" /> : <Fullscreen fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Tooltip title={t('panels.dock')}>
        <IconButton size="small" onClick={() => window.close()} aria-label={t('panels.dock')}>
          <CallReceived fontSize="small" />
        </IconButton>
      </Tooltip>
    </>
  )

  return (
    <EditorContext.Provider value={{ projectId, leaderId, leader: null }}>
      <PanelFrame title={t(titleKey)} icon={icon} actions={actions}>
        {hasHome && <Component />}
        {connection !== 'connected' && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'background.paper',
              opacity: 0.95,
            }}
          >
            {connection === 'connecting' ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <CircularProgress size={20} /> <span>{t('panels.connecting')}</span>
              </Stack>
            ) : (
              <Stack spacing={2} sx={{ alignItems: 'center' }}>
                <Typography>{t('panels.lost')}</Typography>
                <Button variant="contained" href={`/editor/${projectId}`} target="_blank">
                  {t('panels.openEditor')}
                </Button>
              </Stack>
            )}
          </Box>
        )}
      </PanelFrame>
      <DialogHost />
    </EditorContext.Provider>
  )
}
