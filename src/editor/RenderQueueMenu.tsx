import Close from '@mui/icons-material/Close'
import Download from '@mui/icons-material/Download'
import ErrorOutline from '@mui/icons-material/ErrorOutlineOutlined'
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined'
import Stop from '@mui/icons-material/Stop'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PhotoDialog } from '../view3d/PhotoDialog'
import { clearFinished, downloadJob, isPending, jobLabel, jobProgress, openPhotoDialog, removeJob, type RenderJob, startRenderQueue, stopJob, useRenderQueue } from '../view3d/renderQueue'

/** Percentage of a job as a ring with the number inside. */
function JobProgress({ job }: { job: RenderJob }) {
  const { t } = useTranslation()
  if (job.state === 'error') return <ErrorOutline color="error" />
  const percent = Math.floor(jobProgress(job) * 100)
  return (
    <Tooltip title={t(`renderQueue.states.${job.state}`)}>
      <Box sx={{ position: 'relative', display: 'inline-flex', width: 40, height: 40 }}>
        <CircularProgress
          variant={job.state === 'preparing' ? 'indeterminate' : 'determinate'}
          value={percent}
          size={40}
          color={job.state === 'done' ? 'success' : 'primary'}
          sx={{ opacity: job.state === 'queued' ? 0.4 : 1 }}
        />
        <Typography variant="caption" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 11 }}>
          {`${percent} %`}
        </Typography>
      </Box>
    </Tooltip>
  )
}

/**
 * Title bar icon with all photo renderings of this window: status and percentage per job, download
 * of finished images; a click on a job opens it in the photo dialog. Also hosts the photo dialog.
 */
export function RenderQueueMenu() {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const jobs = useRenderQueue((s) => s.jobs)
  const sceneAvailable = useRenderQueue((s) => s.sceneAvailable)
  const pending = jobs.filter(isPending).length
  const running = jobs.find((j) => j.state === 'preparing' || j.state === 'rendering')
  useEffect(startRenderQueue, [])

  const open = (id: string | null) => {
    setAnchor(null)
    openPhotoDialog(id)
  }

  return (
    <>
      <Tooltip title={t('renderQueue.title')}>
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label={t('renderQueue.title')}>
          <Badge badgeContent={pending} color="primary" invisible={pending === 0}>
            <PhotoLibraryOutlined fontSize="small" />
          </Badge>
          {running && (
            <CircularProgress
              size={30}
              thickness={2}
              variant={running.state === 'preparing' ? 'indeterminate' : 'determinate'}
              value={jobProgress(running) * 100}
              sx={{ position: 'absolute', pointerEvents: 'none' }}
            />
          )}
        </IconButton>
      </Tooltip>
      <Popover
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ width: 420, maxWidth: 'calc(100vw - 32px)' }}>
          <Typography variant="subtitle2" sx={{ px: 2, pt: 1.5 }}>
            {t('renderQueue.title')}
          </Typography>
          {jobs.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
              {t('renderQueue.empty')}
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: '60vh', overflow: 'auto' }}>
              {jobs.map((job) => (
                <ListItem key={job.id} disablePadding>
                  <ListItemButton onClick={() => open(job.id)} sx={{ flex: 1, minWidth: 0, pr: 1 }}>
                    <Box
                      component={job.result ?? job.preview ? 'img' : 'div'}
                      src={job.result ?? job.preview ?? undefined}
                      alt=""
                      sx={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 0.5, mr: 1.5, flexShrink: 0, bgcolor: 'action.hover' }}
                    />
                    <ListItemText
                      primary={t('photo.numbered', { number: job.number })}
                      secondary={`${jobLabel(job, t)} · ${t(`renderQueue.states.${job.state}`)}`}
                      slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                    />
                  </ListItemButton>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', pr: 1, flexShrink: 0 }}>
                    <JobProgress job={job} />
                    <Tooltip title={t('photo.download')}>
                      <span>
                        <IconButton size="small" disabled={job.state !== 'done'} onClick={() => downloadJob(job)} aria-label={t('photo.download')}>
                          <Download fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    {job.state === 'rendering' ? (
                      <Tooltip title={t('photo.stop')}>
                        <IconButton size="small" onClick={() => stopJob(job.id)} aria-label={t('photo.stop')}>
                          <Stop fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title={t(isPending(job) ? 'renderQueue.cancel' : 'renderQueue.remove')}>
                        <IconButton size="small" onClick={() => removeJob(job.id)} aria-label={t(isPending(job) ? 'renderQueue.cancel' : 'renderQueue.remove')}>
                          <Close fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </ListItem>
              ))}
            </List>
          )}
          <Stack direction="row" spacing={1} sx={{ px: 2, pb: 1.5, pt: jobs.length === 0 ? 0 : 0.5, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={clearFinished} disabled={!jobs.some((j) => !isPending(j))}>
              {t('renderQueue.clearFinished')}
            </Button>
            <Button size="small" variant="contained" onClick={() => open(null)} disabled={!sceneAvailable}>
              {t('renderQueue.new')}
            </Button>
          </Stack>
        </Box>
      </Popover>
      <PhotoDialog />
    </>
  )
}
