import Explore from '@mui/icons-material/Explore'
import WbSunny from '@mui/icons-material/WbSunny'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Popover from '@mui/material/Popover'
import Slider from '@mui/material/Slider'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openCompassDialog } from '../dialogs/dialogStore'
import type { Home } from '../model/home'
import { dispatch } from '../store/editorStore'
import { useBrightRoomsStore } from './brightRooms'
import { compassPoint, fromZoned, sunPosition, sunriseSunset, toZoned } from './sun'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`

/** Datum und Uhrzeit für den Sonnenstand, in der Zeitzone des Kompasses (wie „3D-Ansicht ändern“ in Sweet Home 3D). */
export function SunPopover({ home }: { home: Home }) {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const brightRooms = useBrightRoomsStore((s) => s.brightRooms)
  const setBrightRooms = useBrightRoomsStore((s) => s.setBrightRooms)
  const { compass } = home
  const { time } = home.camera
  const zoned = toZoned(time, compass.timeZone)
  const sun = sunPosition(time, compass.latitude, compass.longitude)
  const elevation = Math.round((sun.elevation * 180) / Math.PI)
  const days = sunriseSunset(compass, time)
  const setTime = (next: number) => Number.isFinite(next) && dispatch({ type: 'camera', camera: { time: next } })
  const date = `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}`

  return (
    <>
      <Tooltip title={t('sun.title')}>
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label={t('sun.title')}>
          <WbSunny fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 2, width: 320, display: 'flex', flexDirection: 'column', gap: 1.5 } } }}
      >
        <Typography variant="subtitle2">{t('sun.title')}</Typography>
        <TextField
          size="small"
          type="date"
          label={t('sun.date')}
          value={date}
          onChange={(e) => {
            const [year, month, day] = e.target.value.split('-').map(Number)
            if (year && month && day) setTime(fromZoned({ year, month, day, minutes: zoned.minutes }, compass.timeZone))
          }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t('sun.time', { time: clock(zoned.minutes), zone: compass.timeZone })}
          </Typography>
          <Slider
            size="small"
            min={0}
            max={24 * 60 - 15}
            step={15}
            value={zoned.minutes - (zoned.minutes % 15)}
            valueLabelDisplay="auto"
            valueLabelFormat={clock}
            onChange={(_, minutes) => setTime(fromZoned({ ...zoned, minutes: minutes as number }, compass.timeZone))}
            aria-label={t('sun.timeLabel')}
          />
        </Box>
        <Typography variant="body2">
          {elevation > 0 ? t('sun.position', { direction: t(`sun.points.${compassPoint(sun.azimuth)}`), elevation }) : t('sun.belowHorizon')}
        </Typography>
        {days && (
          <Typography variant="body2" color="text.secondary">
            {t('sun.riseSet', { sunrise: clock(toZoned(days.sunrise, compass.timeZone).minutes), sunset: clock(toZoned(days.sunset, compass.timeZone).minutes) })}
          </Typography>
        )}
        <FormControlLabel
          control={<Checkbox size="small" checked={brightRooms} onChange={(e) => setBrightRooms(e.target.checked)} />}
          label={<Typography variant="body2">{t('sun.brightRooms')}</Typography>}
        />
        <Button
          size="small"
          startIcon={<Explore />}
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => {
            setAnchor(null)
            openCompassDialog()
          }}
        >
          {t('sun.compass')}
        </Button>
      </Popover>
    </>
  )
}
