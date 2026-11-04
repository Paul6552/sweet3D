import Minimize from '@mui/icons-material/Minimize'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBrightRoomsStore } from './brightRooms'
import { PHOTO_SIZES, QUALITY_KEYS, SAMPLE_OPTIONS } from './photoRender'
import { closePhotoDialog, downloadJob, enqueuePhoto, isPending, jobLabel, jobProgress, openPhotoDialog, type RenderJob, stopJob, useRenderQueue } from './renderQueue'

interface PhotoSettings {
  /** Index into PHOTO_SIZES. */
  size: number
  maxSamples: number
  denoise: boolean
}

const SETTINGS_KEY = 'sweet3d.photoSettings'
/** Full HD and good quality: sharp enough for most uses without long waits. */
const DEFAULT_SETTINGS: PhotoSettings = { size: 1, maxSamples: 256, denoise: true }

/** The settings of the last photo, so they do not have to be chosen again after a reload. */
function loadSettings(): PhotoSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<PhotoSettings> | null
    if (!stored) return DEFAULT_SETTINGS
    return {
      size: typeof stored.size === 'number' && PHOTO_SIZES[stored.size] ? stored.size : DEFAULT_SETTINGS.size,
      maxSamples: typeof stored.maxSamples === 'number' && SAMPLE_OPTIONS.includes(stored.maxSamples) ? stored.maxSamples : DEFAULT_SETTINGS.maxSamples,
      denoise: typeof stored.denoise === 'boolean' ? stored.denoise : DEFAULT_SETTINGS.denoise,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: PhotoSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked (private mode): the settings only last for this session
  }
}

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
  const [settings, setSettings] = useState(loadSettings)
  const { size, maxSamples, denoise } = settings
  const change = (part: Partial<PhotoSettings>) => {
    const next = { ...settings, ...part }
    setSettings(next)
    saveSettings(next)
  }
  // Acts through the scene of the 3D view (see HomeScene); only a notice here
  const brightRooms = useBrightRoomsStore((s) => s.brightRooms)

  const enqueue = (show: boolean) => {
    const id = enqueuePhoto(size, maxSamples, denoise)
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
              <TextField select size="small" label={t('photo.size')} value={size} onChange={(e) => change({ size: Number(e.target.value) })}>
                {PHOTO_SIZES.map((s, i) => (
                  <MenuItem key={s.label} value={i}>
                    {`${s.label} (${s.width} × ${s.height})`}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label={t('photo.quality')} value={maxSamples} onChange={(e) => change({ maxSamples: Number(e.target.value) })}>
                {SAMPLE_OPTIONS.map((n, i) => (
                  <MenuItem key={n} value={n}>
                    {t(QUALITY_KEYS[i])}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={<Checkbox checked={denoise} onChange={(e) => change({ denoise: e.target.checked })} />}
                label={t('photo.denoise')}
              />
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
