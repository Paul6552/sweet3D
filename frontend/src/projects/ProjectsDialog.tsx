import Add from '@mui/icons-material/Add'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNotify } from '../editor/useNotify'
import {
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  isQuotaError,
  listProjects,
  renameProject,
  storageEstimate,
  type ProjectSummary,
} from '../storage/projects'
import { useEditorStore } from '../store/editorStore'
import { downloadSh3d, importSh3dFile } from './projectFiles'

const readSnapshot = async () => {
  const [projects, storage] = await Promise.all([listProjects(), storageEstimate()])
  return { projects, storage }
}

type NameDialog = { mode: 'create' } | { mode: 'rename'; project: ProjectSummary }

interface ProjectsDialogProps {
  onClose: () => void
  currentId: string
  /** Meldet die Umbenennung des geöffneten Projekts an den Editor. */
  onRenamed: (name: string) => void
}

/**
 * Projektverwaltung im Browser: anlegen, öffnen, umbenennen, duplizieren, löschen, .sh3d importieren
 * und herunterladen. Wird nur eingehängt, solange er offen ist, und liest die Projekte dabei frisch.
 */
export function ProjectsDialog({ onClose, currentId, onRenamed }: ProjectsDialogProps) {
  const { t, i18n } = useTranslation()
  const notify = useNotify()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<{ projects: ProjectSummary[]; storage: { usage: number; quota: number } | null } | null>(null)
  const projects = snapshot?.projects ?? []
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null)
  const [name, setName] = useState('')
  const [toDelete, setToDelete] = useState<ProjectSummary | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const language = i18n.resolvedLanguage ?? 'de'

  const refresh = useCallback(() => readSnapshot().then(setSnapshot), [])

  useEffect(() => {
    let cancelled = false
    void readSnapshot().then((next) => !cancelled && setSnapshot(next))
    return () => {
      cancelled = true
    }
  }, [])

  const openProject = (id: string) => {
    onClose()
    if (id !== currentId) void navigate({ to: '/editor/$projectId', params: { projectId: id } })
  }

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (error) {
      console.error(error)
      notify(isQuotaError(error) ? t('projects.importErrors.quota') : String(error))
    }
    await refresh()
  }

  const showNameDialog = (next: NameDialog) => {
    setName(next.mode === 'rename' ? next.project.name : t('projects.defaultName'))
    setNameDialog(next)
  }

  const submitName = () => {
    if (!nameDialog || !name.trim()) return
    const dialog = nameDialog
    setNameDialog(null)
    void run(async () => {
      if (dialog.mode === 'create') {
        openProject((await createProject(name)).id)
      } else {
        await renameProject(dialog.project.id, name)
        if (dialog.project.id === currentId) onRenamed(name.trim())
      }
    })
  }

  const duplicate = (project: ProjectSummary) =>
    void run(() => {
      const copyName = t('projects.copyName', { name: project.name })
      // Das geöffnete Projekt mit dem aktuellen, evtl. noch nicht gespeicherten Stand kopieren
      const home = project.id === currentId ? (useEditorStore.getState().home ?? undefined) : undefined
      return duplicateProject(project.id, copyName, home)
    })

  const confirmDelete = () => {
    if (!toDelete) return
    const deleted = toDelete
    setToDelete(null)
    void run(() => deleteProject(deleted.id)).then(() => {
      if (deleted.id === currentId) {
        onClose()
        void navigate({ to: '/', replace: true })
      }
    })
  }

  const download = async (project: ProjectSummary) => {
    const home = project.id === currentId ? useEditorStore.getState().home : (await getProject(project.id))?.home
    if (!home) return
    try {
      await downloadSh3d(home, project.name, language)
    } catch (error) {
      console.error(error)
      notify(t('projects.downloadError'))
    }
  }

  const importFile = async (file: File) => {
    setImporting(true)
    const outcome = await importSh3dFile(file, language)
    setImporting(false)
    if (!outcome.ok) {
      notify(t(`projects.importErrors.${outcome.error}`))
      return
    }
    const hints = [t('projects.imported', { name: outcome.project.name })]
    if (outcome.skippedLevels) hints.push(t('projects.importSkippedLevels', { count: outcome.skippedLevels }))
    if (outcome.missingModels) hints.push(t('projects.importMissingModels', { count: outcome.missingModels }))
    notify(hints.join(' '))
    openProject(outcome.project.id)
  }

  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' })
  const sizeFormat = new Intl.NumberFormat(language, { maximumFractionDigits: 1 })
  const formatSize = (bytes: number) =>
    bytes >= 1024 ** 3 ? `${sizeFormat.format(bytes / 1024 ** 3)} GB` : `${sizeFormat.format(bytes / 1024 ** 2)} MB`

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{t('projects.title')}</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <List dense disablePadding>
            {projects.map((project) => (
              <ListItem
                key={project.id}
                disablePadding
                secondaryAction={
                  <Stack direction="row">
                    <Tooltip title={t('projects.rename')}>
                      <IconButton size="small" onClick={() => showNameDialog({ mode: 'rename', project })} aria-label={t('projects.rename')}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('projects.duplicate')}>
                      <IconButton size="small" onClick={() => duplicate(project)} aria-label={t('projects.duplicate')}>
                        <ContentCopyOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('projects.download')}>
                      <IconButton size="small" onClick={() => void download(project)} aria-label={t('projects.download')}>
                        <DownloadOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('projects.delete')}>
                      <IconButton size="small" onClick={() => setToDelete(project)} aria-label={t('projects.delete')}>
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              >
                <ListItemButton selected={project.id === currentId} onClick={() => openProject(project.id)} sx={{ pr: 20 }}>
                  <ListItemText
                    primary={
                      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <span>{project.name}</span>
                        {project.id === currentId && <Chip size="small" label={t('projects.current')} />}
                      </Box>
                    }
                    secondary={t('projects.updated', { date: dateFormat.format(new Date(project.updatedAt)) })}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 3, py: 1.5 }}>
            {t('projects.hint')}{' '}
            {snapshot?.storage && t('projects.storage', { used: formatSize(snapshot.storage.usage), quota: formatSize(snapshot.storage.quota) })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1}>
            <Button startIcon={<Add />} onClick={() => showNameDialog({ mode: 'create' })}>
              {t('projects.new')}
            </Button>
            <Button startIcon={<UploadFileOutlined />} disabled={importing} onClick={() => fileInput.current?.click()}>
              {importing ? t('projects.importing') : t('projects.import')}
            </Button>
          </Stack>
          <Button onClick={onClose}>{t('projects.cancel')}</Button>
        </DialogActions>
        <input
          ref={fileInput}
          type="file"
          accept=".sh3d"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void importFile(file)
          }}
        />
      </Dialog>

      <Dialog open={nameDialog !== null} onClose={() => setNameDialog(null)} fullWidth maxWidth="xs">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitName()
          }}
        >
          <DialogTitle>{nameDialog?.mode === 'rename' ? t('projects.rename') : t('projects.new')}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              margin="dense"
              label={t('projects.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
              slotProps={{ htmlInput: { maxLength: 255 } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setNameDialog(null)}>{t('projects.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={!name.trim()}>
              {nameDialog?.mode === 'rename' ? t('projects.save') : t('projects.create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)}>
        <DialogContent>{t('projects.deleteConfirm', { name: toDelete?.name })}</DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>{t('projects.cancel')}</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>
            {t('projects.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
