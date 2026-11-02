import ExploreOutlined from '@mui/icons-material/ExploreOutlined'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import { useTheme } from '@mui/material/styles'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, Group, Image, Layer, Line, Stage } from 'react-konva'
import { wheelDelta } from '../editor/wheel'
import { CONTENT_PREFIX } from '../model/contents'
import { backgroundImageOrigin, backgroundImageTransform, imageToPlan, planToImage, type BackgroundImage } from '../model/home'
import { useImage } from '../plan/useImage'
import { useResolvedRef } from '../storage/contents'
import { saveContents } from '../storage/projects'
import { executeCommand, useEditorStore } from '../store/editorStore'

type Pixel = [number, number]

const STAGE_HEIGHT = 420
const HANDLE = 7

const parse = (text: string) => Number.parseFloat(text.replace(',', '.'))
const format = (value: number, digits = 2) => String(Math.round(value * 10 ** digits) / 10 ** digits)
const toDegrees = (radians: number) => (((radians * 180) / Math.PI) % 360 + 360) % 360

/** Calibration state of the dialog, derived from a stored background image or a new one. */
interface Calibration {
  start: Pixel
  end: Pixel
  /** Length of start–end in m. */
  length: string
  /** Pixel that is placed at the plan point (x, y). */
  origin: Pixel
  x: string
  y: string
  rotation: string
}

function calibrationOf(image: BackgroundImage, width: number, height: number): Calibration {
  const transform = backgroundImageTransform(image)
  // Pixel at the plan origin, unless it lies outside the image: then the image center
  let origin = planToImage(transform, [0, 0])
  let at: Pixel = [0, 0]
  if (origin[0] < 0 || origin[1] < 0 || origin[0] > width || origin[1] > height) {
    origin = [width / 2, height / 2]
    at = imageToPlan(transform, origin)
  }
  return {
    start: [image.scaleDistanceXStart, image.scaleDistanceYStart],
    end: [image.scaleDistanceXEnd, image.scaleDistanceYEnd],
    length: format(image.scaleDistance / 100),
    origin,
    x: format(at[0], 0),
    y: format(at[1], 0),
    rotation: format(toDegrees(transform.rotation), 1),
  }
}

function newCalibration(width: number, height: number): Calibration {
  return {
    start: [width * 0.3, height * 0.5],
    end: [width * 0.7, height * 0.5],
    length: '',
    origin: [width / 2, height / 2],
    x: '0',
    y: '0',
    rotation: '0',
  }
}

/**
 * Imports and calibrates the background image of the plan, e.g. a north-up screenshot of a
 * satellite map: a measuring line on the scale bar (or a known edge) sets the scale, a crosshair
 * the image point that lies at a given plan position. Optionally the image is also the ground of
 * the 3D view, like the background image wizard of Sweet Home 3D.
 */
export function BackgroundImageDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const environment = useEditorStore((s) => s.home?.environment)
  const northDirection = useEditorStore((s) => s.home?.compass.northDirection ?? 0)
  const stored = environment?.backgroundImage ?? null
  const [imageRef, setImageRef] = useState<string | null>(stored?.image ?? null)
  const [visible, setVisible] = useState(stored?.visible ?? true)
  const [onGround, setOnGround] = useState(stored ? (environment?.backgroundImageOnGround ?? true) : true)
  /** Edited calibration of the image {@code ref}; before the first edit it is derived from the image. */
  const [edited, setEdited] = useState<{ ref: string; value: Calibration } | null>(null)
  const [uploading, setUploading] = useState(false)
  const url = useResolvedRef(imageRef)
  const image = useImage(url)
  const fileInput = useRef<HTMLInputElement>(null)

  // Once the image size is known: the stored calibration for the stored image, otherwise a new one
  const calibration = useMemo(() => {
    if (edited && edited.ref === imageRef) return edited.value
    if (!image || !imageRef) return null
    const { naturalWidth: w, naturalHeight: h } = image
    return stored && stored.image === imageRef ? calibrationOf(stored, w, h) : newCalibration(w, h)
  }, [edited, image, imageRef, stored])

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const key = crypto.randomUUID()
      await saveContents({ [key]: file })
      setImageRef(`${CONTENT_PREFIX}${key}`)
    } finally {
      setUploading(false)
    }
  }

  const length = calibration ? parse(calibration.length) : NaN
  const x = calibration ? parse(calibration.x) : NaN
  const y = calibration ? parse(calibration.y) : NaN
  const rotation = calibration ? parse(calibration.rotation) : NaN
  const pixels = calibration ? Math.hypot(calibration.end[0] - calibration.start[0], calibration.end[1] - calibration.start[1]) : 0
  const valid = !!calibration && length > 0 && pixels > 0 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(rotation)
  const update = (change: Partial<Calibration>) => {
    if (calibration && imageRef) setEdited({ ref: imageRef, value: { ...calibration, ...change } })
  }

  const save = () => {
    if (!valid || !calibration || !imageRef) return
    const radians = (rotation * Math.PI) / 180
    const scaleDistance = length * 100
    const backgroundImage: BackgroundImage = {
      image: imageRef,
      scaleDistance,
      scaleDistanceXStart: calibration.start[0],
      scaleDistanceYStart: calibration.start[1],
      scaleDistanceXEnd: calibration.end[0],
      scaleDistanceYEnd: calibration.end[1],
      ...backgroundImageOrigin(calibration.origin, [x, y], scaleDistance / pixels, radians),
      visible,
      ...(radians !== 0 && { rotation: radians }),
    }
    executeCommand({ type: 'updateEnvironment', change: { backgroundImage, backgroundImageOnGround: onGround } })
    onClose()
  }

  const remove = () => {
    executeCommand({ type: 'updateEnvironment', change: { backgroundImage: null } })
    onClose()
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <DialogTitle>{t('backgroundImage.title')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <DialogContentText variant="body2">{t(imageRef ? 'backgroundImage.calibrateHint' : 'backgroundImage.importHint')}</DialogContentText>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void upload(file)
            }}
          />
          {!imageRef && (
            <Button variant="outlined" startIcon={uploading ? <CircularProgress size={16} /> : <UploadFileOutlined />} onClick={() => fileInput.current?.click()} disabled={uploading} sx={{ alignSelf: 'flex-start' }}>
              {t('backgroundImage.choose')}
            </Button>
          )}
          {imageRef && (!image || !calibration) && <CircularProgress size={24} />}
          {image && calibration && (
            <>
              <CalibrationStage
                image={image}
                calibration={calibration}
                onChange={update}
                lineColor={theme.palette.error.main}
                originColor={theme.palette.primary.main}
                background={theme.palette.action.hover}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <TextField
                  label={t('backgroundImage.length')}
                  value={calibration.length}
                  onChange={(e) => update({ length: e.target.value })}
                  error={calibration.length.trim() !== '' && !(length > 0)}
                  required
                  autoFocus
                  size="small"
                  sx={{ width: 170 }}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">m</InputAdornment> } }}
                />
                <TextField
                  label={t('backgroundImage.originX')}
                  value={calibration.x}
                  onChange={(e) => update({ x: e.target.value })}
                  error={!Number.isFinite(x)}
                  size="small"
                  sx={{ width: 140 }}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">cm</InputAdornment> } }}
                />
                <TextField
                  label={t('backgroundImage.originY')}
                  value={calibration.y}
                  onChange={(e) => update({ y: e.target.value })}
                  error={!Number.isFinite(y)}
                  size="small"
                  sx={{ width: 140 }}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">cm</InputAdornment> } }}
                />
                <TextField
                  label={t('backgroundImage.rotation')}
                  value={calibration.rotation}
                  onChange={(e) => update({ rotation: e.target.value })}
                  error={!Number.isFinite(rotation)}
                  size="small"
                  sx={{ width: 120 }}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">°</InputAdornment> } }}
                />
                <Tooltip title={t('backgroundImage.alignNorthHint')}>
                  <Button size="small" startIcon={<ExploreOutlined />} onClick={() => update({ rotation: format(toDegrees(northDirection), 1) })}>
                    {t('backgroundImage.alignNorth')}
                  </Button>
                </Tooltip>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
                <FormControlLabel control={<Checkbox checked={visible} onChange={(e) => setVisible(e.target.checked)} />} label={t('backgroundImage.visible')} />
                <FormControlLabel control={<Checkbox checked={onGround} onChange={(e) => setOnGround(e.target.checked)} />} label={t('backgroundImage.onGround')} />
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          {stored && (
            <Button color="error" onClick={remove} sx={{ mr: 'auto' }}>
              {t('backgroundImage.remove')}
            </Button>
          )}
          {imageRef && (
            <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
              {t('backgroundImage.replace')}
            </Button>
          )}
          <Button onClick={onClose}>{t('projects.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid}>
            {t('dialogs.ok')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * Image with the draggable measuring line and origin crosshair; the wheel zooms around the cursor,
 * dragging the empty image pans.
 */
function CalibrationStage({
  image,
  calibration,
  onChange,
  lineColor,
  originColor,
  background,
}: {
  image: HTMLImageElement
  calibration: Calibration
  onChange: (change: Partial<Calibration>) => void
  lineColor: string
  originColor: string
  background: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [panned, setView] = useState<{ scale: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The whole image fits until the user zooms or pans
  const fit = Math.min(width / image.naturalWidth, STAGE_HEIGHT / image.naturalHeight)
  const view = panned ?? { scale: fit, x: (width - image.naturalWidth * fit) / 2, y: (STAGE_HEIGHT - image.naturalHeight * fit) / 2 }

  const onWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const stage = event.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    const factor = Math.pow(1.0015, -wheelDelta(event.evt, STAGE_HEIGHT))
    const scale = Math.min(Math.max(view.scale * factor, 0.02), 40)
    const ratio = scale / view.scale
    setView({ scale, x: pointer.x - (pointer.x - view.x) * ratio, y: pointer.y - (pointer.y - view.y) * ratio })
  }

  const s = view.scale
  /** Handle position in image pixels after dragging; the handles live in the scaled group. */
  const dragged = (event: KonvaEventObject<DragEvent>): Pixel => [event.target.x(), event.target.y()]
  const { start, end, origin } = calibration
  const cross = 14 / s

  return (
    <Box ref={container} sx={{ width: '100%', height: STAGE_HEIGHT, bgcolor: background, borderRadius: 1, overflow: 'hidden', cursor: 'grab' }}>
      {width > 0 && (
        <Stage width={width} height={STAGE_HEIGHT} onWheel={onWheel}>
          <Layer>
            <Group
              x={view.x}
              y={view.y}
              scaleX={s}
              scaleY={s}
              draggable
              onDragEnd={(e) => {
                // Only the group itself pans; handles report their own drags
                if (e.target === e.currentTarget) setView({ scale: s, x: e.target.x(), y: e.target.y() })
              }}
            >
              <Image image={image} />
              <Line points={[...start, ...end]} stroke={lineColor} strokeWidth={2 / s} listening={false} />
              {([start, end] as const).map((point, i) => (
                <Circle
                  key={i}
                  x={point[0]}
                  y={point[1]}
                  radius={HANDLE / s}
                  stroke={lineColor}
                  strokeWidth={2 / s}
                  fill="rgba(255,255,255,0.5)"
                  draggable
                  onDragMove={(e) => onChange(i === 0 ? { start: dragged(e) } : { end: dragged(e) })}
                  onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = 'move')}
                  onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = '')}
                />
              ))}
              <Group
                x={origin[0]}
                y={origin[1]}
                draggable
                onDragMove={(e) => onChange({ origin: dragged(e) })}
                onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = 'move')}
                onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = '')}
              >
                <Circle radius={cross} stroke={originColor} strokeWidth={2 / s} fill="rgba(255,255,255,0.25)" />
                <Line points={[-cross * 1.6, 0, cross * 1.6, 0]} stroke={originColor} strokeWidth={2 / s} />
                <Line points={[0, -cross * 1.6, 0, cross * 1.6]} stroke={originColor} strokeWidth={2 / s} />
              </Group>
            </Group>
          </Layer>
        </Stage>
      )}
    </Box>
  )
}
