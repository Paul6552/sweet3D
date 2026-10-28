import Add from '@mui/icons-material/Add'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import HomeWorkOutlined from '@mui/icons-material/HomeWorkOutlined'
import Logout from '@mui/icons-material/Logout'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { projectsApi, type ProjectSummary } from '../api/projects'
import { displayName, logout } from '../auth/keycloak'

type NameDialog = { mode: 'create' } | { mode: 'rename'; project: ProjectSummary }

export function ProjectsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState(false)
  const [dialog, setDialog] = useState<NameDialog | null>(null)
  const [name, setName] = useState('')
  const [toDelete, setToDelete] = useState<ProjectSummary | null>(null)

  const reload = useCallback(() => {
    projectsApi.list().then(setProjects, () => setError(true))
  }, [])

  useEffect(() => {
    document.title = 'Sweet3D'
    reload()
  }, [reload])

  const openDialog = (next: NameDialog) => {
    setName(next.mode === 'rename' ? next.project.name : '')
    setDialog(next)
  }

  const submit = async () => {
    if (!dialog || !name.trim()) return
    if (dialog.mode === 'create') {
      const project = await projectsApi.create(name.trim())
      await navigate({ to: '/editor/$projectId', params: { projectId: project.id } })
    } else {
      await projectsApi.update(dialog.project.id, { name: name.trim(), version: dialog.project.version })
      reload()
    }
    setDialog(null)
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    await projectsApi.remove(toDelete.id)
    setToDelete(null)
    reload()
  }

  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          <HomeWorkOutlined color="primary" />
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>
            {t('app.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {displayName()}
          </Typography>
          <Tooltip title={t('app.logout')}>
            <IconButton onClick={logout} aria-label={t('app.logout')}>
              <Logout />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Typography variant="h5" sx={{ flex: 1 }}>
            {t('projects.title')}
          </Typography>
          <Button variant="contained" startIcon={<Add />} onClick={() => openDialog({ mode: 'create' })}>
            {t('projects.new')}
          </Button>
        </Box>
        {error && <Alert severity="error">{t('projects.loadError')}</Alert>}
        {!projects && !error && <CircularProgress />}
        {projects?.length === 0 && <Typography color="text.secondary">{t('projects.empty')}</Typography>}
        <Grid container spacing={2}>
          {projects?.map((project) => (
            <Grid key={project.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card variant="outlined">
                <CardActionArea onClick={() => void navigate({ to: '/editor/$projectId', params: { projectId: project.id } })}>
                  <CardContent>
                    <Typography variant="h6" noWrap>
                      {project.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('projects.updated', { date: dateFormat.format(new Date(project.updatedAt)) })}
                    </Typography>
                  </CardContent>
                </CardActionArea>
                <CardActions sx={{ justifyContent: 'flex-end' }}>
                  <Tooltip title={t('projects.rename')}>
                    <IconButton size="small" onClick={() => openDialog({ mode: 'rename', project })} aria-label={t('projects.rename')}>
                      <EditOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('projects.delete')}>
                    <IconButton size="small" onClick={() => setToDelete(project)} aria-label={t('projects.delete')}>
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} fullWidth maxWidth="xs">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogTitle>{dialog?.mode === 'rename' ? t('projects.rename') : t('projects.new')}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              margin="dense"
              label={t('projects.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 255 } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialog(null)}>{t('projects.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={!name.trim()}>
              {dialog?.mode === 'rename' ? t('projects.save') : t('projects.create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)}>
        <DialogContent>{t('projects.deleteConfirm', { name: toDelete?.name })}</DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>{t('projects.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()}>
            {t('projects.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
