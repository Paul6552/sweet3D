import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { compassBesideHome, type Compass } from '../model/home'
import { executeCommand, useEditorStore } from '../store/editorStore'
import { degrees, useCheckField, useNumberField } from './fields'
import { Grid } from './layout'

/** Grad mit Vorzeichen (Breite/Länge), anders als {@code degrees} nicht auf 0–360° gefaltet. */
const signedDegrees = {
  unit: '°',
  toDisplay: (rad: number) => (rad * 180) / Math.PI,
  fromDisplay: (deg: number) => (deg * Math.PI) / 180,
}

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

/** Kompass wie in Sweet Home 3D: Lage und Nordrichtung im Plan, geografische Lage und Zeitzone für den Sonnenstand. */
export function CompassDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const compass = useEditorStore((s) => s.home?.compass)
  const home = useEditorStore((s) => s.home)
  const [initial] = useState(() => compass!)
  const items = [initial]
  const fields = [
    useNumberField<Compass>(items, t('compass.x'), (c) => c.x, (ch, v) => (ch.x = v!)),
    useNumberField<Compass>(items, t('compass.y'), (c) => c.y, (ch, v) => (ch.y = v!)),
    useNumberField<Compass>(items, t('compass.diameter'), (c) => c.diameter, (ch, v) => (ch.diameter = v!), { min: 0, exclusiveMin: true }),
    useNumberField<Compass>(items, t('compass.north'), (c) => c.northDirection, (ch, v) => (ch.northDirection = v!), degrees),
    useNumberField<Compass>(items, t('compass.latitude'), (c) => c.latitude, (ch, v) => (ch.latitude = v!), { ...signedDegrees, min: -90 }),
    useNumberField<Compass>(items, t('compass.longitude'), (c) => c.longitude, (ch, v) => (ch.longitude = v!), { ...signedDegrees, min: -180 }),
  ]
  const visible = useCheckField<Compass>(items, t('compass.visible'), (c) => c.visible, (ch, v) => (ch.visible = v))
  const [timeZone, setTimeZone] = useState(initial.timeZone)
  const zones = useMemo(() => timeZones(), [])

  const change: Partial<Compass> = {}
  for (const field of [...fields, visible]) if (field.dirty) field.apply(change, initial)
  if (timeZone !== initial.timeZone) change.timeZone = timeZone
  const inRange = (change.latitude === undefined || Math.abs(change.latitude) <= Math.PI / 2) && (change.longitude === undefined || Math.abs(change.longitude) <= Math.PI)
  const valid = fields.every((f) => f.valid) && inRange && timeZone !== ''

  const save = (extra: Partial<Compass> = {}) => {
    if (!valid) return
    const all = { ...change, ...extra }
    if (Object.keys(all).length > 0) executeCommand({ type: 'updateCompass', change: all })
    onClose()
  }
  const beside = home ? compassBesideHome(home, change.diameter ?? initial.diameter) : null

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <DialogTitle>{t('compass.title')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Grid>
            {fields.slice(0, 4).map((f, i) => (
              <Box key={i}>{f.node}</Box>
            ))}
            {visible.node}
          </Grid>
          <DialogContentText variant="body2">{t('compass.locationHint')}</DialogContentText>
          <Grid>
            {fields.slice(4).map((f, i) => (
              <Box key={i}>{f.node}</Box>
            ))}
            <Box sx={{ gridColumn: '1 / -1' }}>
              <Autocomplete
                size="small"
                options={zones}
                value={timeZone}
                disableClearable
                onChange={(_, value) => value && setTimeZone(value)}
                renderInput={(params) => <TextField {...params} label={t('compass.timeZone')} />}
              />
            </Box>
          </Grid>
        </DialogContent>
        <DialogActions>
          {/* Liegt der Kompass außerhalb des sichtbaren Plans, holt ihn das zurück */}
          <Button onClick={() => beside && save({ ...beside, visible: true })} disabled={!beside || !valid} sx={{ mr: 'auto' }}>
            {t('compass.besideHome')}
          </Button>
          <Button onClick={onClose}>{t('projects.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid}>
            {t('dialogs.ok')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
