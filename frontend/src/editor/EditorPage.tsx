import ArrowBack from '@mui/icons-material/ArrowBack'
import CallReceived from '@mui/icons-material/CallReceived'
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined'
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined'
import CloudSyncOutlined from '@mui/icons-material/CloudSyncOutlined'
import Redo from '@mui/icons-material/Redo'
import Undo from '@mui/icons-material/Undo'
import WebAssetOutlined from '@mui/icons-material/WebAssetOutlined'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { Link, useParams } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { projectsApi, type ProjectDetail } from '../api/projects'
import { normalizeHome } from '../model/home'
import { dispatch, useEditorStore } from '../store/editorStore'
import { startLeader } from '../sync/leader'
import { closedPanelWindows, focusPanelWindow, leaderIdFor, loadDetachedPanels, openPanelWindow } from '../sync/windows'
import { EditorContext, panelUrl } from './EditorContext'
import { EditorLayout } from './EditorLayout'
import { useLayoutStore } from './layoutStore'
import { useNotify } from './useNotify'
import type { PanelId } from './panelIds'
import { PANELS } from './panels'
import { useAutosave, type SaveState } from './useAutosave'
import { useShortcuts } from './useShortcuts'

const RESTORE_DELAY_MS = 1500

function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useTranslation()
  if (state === 'error' || state === 'conflict') {
    return (
      <Tooltip title={state === 'conflict' ? t('editor.conflict') : ''}>
        <Chip size="small" color="error" icon={<CloudOffOutlined />} label={t('editor.saveError')} />
      </Tooltip>
    )
  }
  const saved = state === 'saved'
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={saved ? <CloudDoneOutlined /> : <CloudSyncOutlined />}
      label={saved ? t('editor.saved') : t('editor.saving')}
    />
  )
}

/** Hauptfenster des Editors: lädt das Projekt, ist Leader für alle herausgelösten Panels. */
export function EditorPage() {
  const { t } = useTranslation()
  const notify = useNotify()
  const { projectId } = useParams({ from: '/editor/$projectId' })
  const leaderId = useMemo(() => leaderIdFor(projectId), [projectId])
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [restorable, setRestorable] = useState<PanelId[]>([])
  const detached = useLayoutStore((s) => s.detached)
  const leader = useLayoutStore((s) => s.leader)
  const setDetached = useLayoutStore((s) => s.setDetached)
  const canUndo = useEditorStore((s) => s.canUndo)
  const canRedo = useEditorStore((s) => s.canRedo)
  const saveState = useAutosave(projectId, project?.version ?? null)
  useShortcuts()

  useEffect(() => {
    let cancelled = false
    projectsApi.get(projectId).then(
      (p) => !cancelled && setProject(p),
      () => !cancelled && setLoadError(true),
    )
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!project) return
    const previouslyDetached = loadDetachedPanels()
    const layout = useLayoutStore.getState()
    const started = startLeader(projectId, leaderId, normalizeHome(project.home), {
      onPanelOpened: (panel) => layout.setDetached(panel, true),
      onPanelClosed: (panel) => layout.setDetached(panel, false),
    })
    layout.setLeader(started)
    // Fenster, die beim letzten Mal herausgelöst waren und sich nicht von selbst melden
    const restoreTimer = window.setTimeout(() => {
      const open = useLayoutStore.getState().detached
      setRestorable(previouslyDetached.filter((p) => !open.includes(p)))
    }, RESTORE_DELAY_MS)
    // Fallback, falls ein Fenster ohne „bye“ geschlossen wurde
    const closedWatcher = window.setInterval(() => {
      for (const panel of closedPanelWindows()) layout.setDetached(panel, false)
    }, 1000)
    return () => {
      window.clearTimeout(restoreTimer)
      window.clearInterval(closedWatcher)
      started.stop()
      layout.setLeader(null)
      layout.reset()
    }
  }, [project, projectId, leaderId])

  useEffect(() => {
    document.title = project ? `${project.name} – Sweet3D` : 'Sweet3D'
  }, [project])

  const restoreNext = () => {
    // Browser erlauben meist nur ein Pop-up pro Klick: je Klick ein Fenster
    const [panel, ...rest] = restorable
    if (openPanelWindow(panelUrl(projectId, leaderId, panel), panel, null)) {
      setDetached(panel, true)
      setRestorable(rest)
    } else {
      notify(t('panels.popupBlocked'))
    }
  }

  if (loadError) {
    return <Alert severity="error" sx={{ m: 2 }}>{t('projects.loadError')}</Alert>
  }
  if (!project || !leader) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} /> <span>{t('editor.loading')}</span>
        </Stack>
      </Box>
    )
  }

  return (
    <EditorContext.Provider value={{ projectId, leaderId, leader }}>
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar variant="dense" sx={{ gap: 1 }}>
            <Tooltip title={t('editor.back')}>
              <IconButton edge="start" component={Link} to="/projects" aria-label={t('editor.back')}>
                <ArrowBack />
              </IconButton>
            </Tooltip>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, mr: 1 }}>
              {project.name}
            </Typography>
            <Tooltip title={`${t('editor.undo')} (Strg+Z)`}>
              <span>
                <IconButton size="small" disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} aria-label={t('editor.undo')}>
                  <Undo fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={`${t('editor.redo')} (Strg+Y)`}>
              <span>
                <IconButton size="small" disabled={!canRedo} onClick={() => dispatch({ type: 'redo' })} aria-label={t('editor.redo')}>
                  <Redo fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            {detached.map((panel) => (
              <Chip
                key={panel}
                size="small"
                color="primary"
                variant="outlined"
                icon={<WebAssetOutlined />}
                label={t(PANELS[panel].titleKey)}
                title={t('panels.focus')}
                onClick={() => focusPanelWindow(panel)}
                onDelete={() => leader.dock(panel)}
                deleteIcon={
                  <Tooltip title={t('panels.dock')}>
                    <CallReceived />
                  </Tooltip>
                }
              />
            ))}
            {restorable.length > 0 && (
              <Button size="small" startIcon={<WebAssetOutlined />} onClick={restoreNext}>
                {t('editor.restoreWindows')} ({restorable.length})
              </Button>
            )}
            <SaveIndicator state={saveState} />
          </Toolbar>
        </AppBar>
        {saveState === 'conflict' && (
          <Alert
            severity="warning"
            square
            action={<Button color="inherit" size="small" onClick={() => window.location.reload()}>{t('editor.reload')}</Button>}
          >
            {t('editor.conflict')}
          </Alert>
        )}
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <EditorLayout />
        </Box>
      </Box>
    </EditorContext.Provider>
  )
}
