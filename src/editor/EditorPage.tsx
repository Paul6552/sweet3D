import CallReceived from '@mui/icons-material/CallReceived'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import ErrorOutlined from '@mui/icons-material/ErrorOutlined'
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined'
import SyncOutlined from '@mui/icons-material/SyncOutlined'
import Redo from '@mui/icons-material/Redo'
import Undo from '@mui/icons-material/Undo'
import WebAssetOutlined from '@mui/icons-material/WebAssetOutlined'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { Navigate, useParams } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadSh3d } from '../projects/projectFiles'
import { ProjectsDialog } from '../projects/ProjectsDialog'
import { getProject, setLastProject } from '../storage/projects'
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
  if (state === 'error') {
    return <Chip size="small" color="error" icon={<ErrorOutlined />} label={t('editor.saveError')} />
  }
  const saved = state === 'saved'
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={saved ? <CheckCircleOutlined /> : <SyncOutlined />}
      label={saved ? t('editor.saved') : t('editor.saving')}
    />
  )
}

/** Hauptfenster des Editors: lädt das Projekt aus dem Browser, ist Leader für alle herausgelösten Panels. */
export function EditorPage() {
  const { t, i18n } = useTranslation()
  const notify = useNotify()
  const { projectId } = useParams({ from: '/editor/$projectId' })
  const leaderId = useMemo(() => leaderIdFor(projectId), [projectId])
  // Nur der Anfangsstand; danach gilt der Editor-Store, den useAutosave zurückschreibt.
  // undefined: wird geladen, null: Projekt existiert nicht (mehr).
  const [loaded, setLoaded] = useState<{ projectId: string; project: Awaited<ReturnType<typeof getProject>> } | null>(null)
  const project = loaded?.projectId === projectId ? loaded.project : undefined
  const [renamed, setRenamed] = useState<{ id: string; name: string } | null>(null)
  const name = renamed?.id === projectId ? renamed.name : (project?.summary.name ?? '')
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [openElsewhere, setOpenElsewhere] = useState(false)
  const [restorable, setRestorable] = useState<PanelId[]>([])
  const detached = useLayoutStore((s) => s.detached)
  const leader = useLayoutStore((s) => s.leader)
  const setDetached = useLayoutStore((s) => s.setDetached)
  const canUndo = useEditorStore((s) => s.canUndo)
  const canRedo = useEditorStore((s) => s.canRedo)
  const saveState = useAutosave(project ? projectId : null)
  useShortcuts()

  useEffect(() => {
    let cancelled = false
    void getProject(projectId).then((p) => !cancelled && setLoaded({ projectId, project: p }))
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (project) setLastProject(projectId)
  }, [project, projectId])

  // Dasselbe Projekt in zwei Tabs würde sich beim Speichern gegenseitig überschreiben. Ein belegter
  // Lock kann auch vom gerade verlassenen Editor dieses Tabs stammen, daher erst nach Wiederholungen warnen.
  useEffect(() => {
    const abort = new AbortController()
    let retry: number | undefined
    const attempt = (remaining: number) => {
      navigator.locks
        .request(`sweet3d-project:${projectId}`, { ifAvailable: true }, (lock) => {
          if (abort.signal.aborted) return
          if (!lock && remaining > 0) {
            retry = window.setTimeout(() => attempt(remaining - 1), 250)
            return
          }
          setOpenElsewhere(lock === null)
          // Lock bis zum Verlassen des Projekts halten
          return lock && new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve()))
        })
        .catch(() => {})
    }
    attempt(4)
    return () => {
      abort.abort()
      window.clearTimeout(retry)
    }
  }, [projectId])

  useEffect(() => {
    if (!project) return
    const previouslyDetached = loadDetachedPanels()
    const layout = useLayoutStore.getState()
    const started = startLeader(projectId, leaderId, project.home, {
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
    document.title = name ? `${name} – Sweet3D` : 'Sweet3D'
  }, [name])

  const download = async () => {
    const home = useEditorStore.getState().home
    if (!home) return
    try {
      await downloadSh3d(home, name, i18n.resolvedLanguage ?? 'de')
    } catch (error) {
      console.error(error)
      notify(t('projects.downloadError'))
    }
  }

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

  if (project === null) {
    // Unbekanntes oder gelöschtes Projekt: zum zuletzt bearbeiteten bzw. einem neuen
    return <Navigate to="/" replace />
  }
  if (!project) return null
  if (!leader) return null

  return (
    <EditorContext.Provider value={{ projectId, leaderId, leader }}>
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar variant="dense" sx={{ gap: 1 }}>
            <Tooltip title={t('editor.projects')}>
              <IconButton edge="start" onClick={() => setProjectsOpen(true)} aria-label={t('editor.projects')}>
                <FolderOpenOutlined />
              </IconButton>
            </Tooltip>
            <Typography
              variant="subtitle1"
              noWrap
              sx={{ fontWeight: 600, mr: 1, cursor: 'pointer' }}
              onClick={() => setProjectsOpen(true)}
            >
              {name}
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
            <Tooltip title={t('projects.download')}>
              <IconButton size="small" onClick={() => void download()} aria-label={t('projects.download')}>
                <DownloadOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
            <SaveIndicator state={saveState} />
          </Toolbar>
        </AppBar>
        {saveState === 'error' && (
          <Alert severity="error" square>
            {t('editor.storageFull')}
          </Alert>
        )}
        {openElsewhere && (
          <Alert severity="warning" square>
            {t('editor.openElsewhere')}
          </Alert>
        )}
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <EditorLayout />
        </Box>
      </Box>
      {projectsOpen && (
        <ProjectsDialog
          onClose={() => setProjectsOpen(false)}
          currentId={projectId}
          onRenamed={(newName) => setRenamed({ id: projectId, name: newName })}
        />
      )}
    </EditorContext.Provider>
  )
}
