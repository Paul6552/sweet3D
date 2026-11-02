import Minimize from '@mui/icons-material/Minimize'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBrightRoomsStore } from './brightRooms'
import { PHOTO_SIZES, QUALITY_KEYS, SAMPLE_OPTIONS } from './photoRender'
import { closePhotoDialog, downloadJob, enqueuePhoto, isPending, jobLabel, jobProgress, openPhotoDialog, type RenderJob, stopJob, useRenderQueue } from './renderQueue'

/** Progress bar, status text and image of one job. */
function JobView({ job }: { job: RenderJob }) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const ahead = useRenderQueue((s) => s.jobs.filter((j) => isPending(j) && s.jobs.indexOf(j) < s.jobs.indexOf(job)).length)

  const preparing = job.state === 'preparing'
  // The canvas of the running path tracer lives outside React; it is shown here while open
  useEffect(() => {
    const element = container.current
    if (!element) return
    // While preparing, the canvas is still empty: show the preview instead
    if (job.canvas && !preparing) element.replaceChildren(job.canvas)
    else element.replaceChildren()
    return () => element.replaceChildren()
  }, [job.canvas, preparing])

  const image = job.canvas && !preparing ? null : (job.result ?? job.preview)
  return (
    <>
      <Box ref={container} sx={{ borderRadius: 1, overflow: 'hidden' }} />
      {image && (
        <Box
          component="img"
          src={image}
          alt=""
          sx={{ display: 'block', width: '100%', borderRadius: 1, opacity: job.result ? 1 : 0.5, aspectRatio: '16 / 9', objectFit: 'cover' }}
        />
      )}
      <Box sx={{ mt: 1 }}>
        <LinearProgress
          variant={job.state === 'preparing' ? 'indeterminate' : 'determinate'}
          color={job.state === 'error' ? 'error' : 'primary'}
          value={jobProgress(job) * 100}
        />
        <Typography variant="caption" color={job.state === 'error' ? 'error' : 'text.secondary'}>
          {job.state === 'queued'
            ? t('renderQueue.waiting', { count: ahead })
            : job.state === 'preparing'
              ? t('photo.preparing')
              : job.state === 'error'
                ? t('photo.error')
                : job.state === 'done'
                  ? t('renderQueue.done')
                  : t('photo.progress', { samples: job.samples, total: job.maxSamples })}
        </Typography>
      </Box>
    </>
  )
}

/**
 * Photorealistic still images of the 3D view by path tracing. Each request is captured and queued
 * (see renderQueue), so several views can be set up in a row while they render in the background.
 * Shows either the settings for a new photo or one queued job.
 */
export function PhotoDialog() {
  const { t } = useTranslation()
  const { open, jobId } = useRenderQueue((s) => s.dialog)
  const job = useRenderQueue((s) => s.jobs.find((j) => j.id === jobId))
  const sceneAvailable = useRenderQueue((s) => s.sceneAvailable)
  const busy = useRenderQueue((s) => s.jobs.some(isPending))
  const [size, setSize] = useState(0)
  const [maxSamples, setMaxSamples] = useState(256)
  // Acts through the scene of the 3D view (see HomeScene); only a notice here
  const brightRooms = useBrightRoomsStore((s) => s.brightRooms)

  const enqueue = (show: boolean) => {
    const id = enqueuePhoto(size, maxSamples)
    if (id && show) openPhotoDialog(id)
    else closePhotoDialog()
  }

  return (
    <Dialog open={open} onClose={closePhotoDialog} maxWidth="lg" fullWidth>
      <DialogTitle>{job ? `${t('photo.numbered', { number: job.number })} · ${jobLabel(job, t)}` : t('photo.title')}</DialogTitle>
      <DialogContent>
        {job ? (
          <>
            {/* Make clear that nobody has to wait for the photo to finish */}
            {isPending(job) && (
              <Alert
                severity="info"
                sx={{ mb: 2 }}
                action={
                  <Button color="inherit" size="small" startIcon={<Minimize />} onClick={closePhotoDialog}>
                    {t('photo.minimize')}
                  </Button>
                }
              >
                {t('photo.background')}
              </Alert>
            )}
            <JobView job={job} />
          </>
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1, flexWrap: 'wrap' }}>
              <TextField select size="small" label={t('photo.size')} value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {PHOTO_SIZES.map((s, i) => (
                  <MenuItem key={s.label} value={i}>
                    {`${s.label} (${s.width} × ${s.height})`}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label={t('photo.quality')} value={maxSamples} onChange={(e) => setMaxSamples(Number(e.target.value))}>
                {SAMPLE_OPTIONS.map((n, i) => (
                  <MenuItem key={n} value={n}>
                    {t(QUALITY_KEYS[i])}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            {brightRooms && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('photo.brightRooms')}
              </Alert>
            )}
            <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
              {sceneAvailable ? t('photo.hint') : t('renderQueue.noScene')}
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        {job && isPending(job) ? (
          <Button startIcon={<Minimize />} onClick={closePhotoDialog}>
            {t('photo.minimize')}
          </Button>
        ) : (
          <Button onClick={closePhotoDialog}>{t('photo.close')}</Button>
        )}
        {job ? (
          <>
            {isPending(job) && <Button onClick={() => stopJob(job.id)}>{t(job.state === 'rendering' ? 'photo.stop' : 'renderQueue.cancel')}</Button>}
            <Button onClick={() => downloadJob(job)} disabled={job.state !== 'done' && job.state !== 'rendering'}>
              {t('photo.download')}
            </Button>
            {sceneAvailable && (
              <Button variant="contained" onClick={() => openPhotoDialog(null)}>
                {t('renderQueue.new')}
              </Button>
            )}
          </>
        ) : (
          <>
            {/* Nothing pending: render and show it; otherwise queue it and go on with the next view */}
            <Button variant="contained" onClick={() => enqueue(!busy)} disabled={!sceneAvailable}>
              {t(busy ? 'photo.enqueue' : 'photo.render')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
