import FitScreen from '@mui/icons-material/FitScreen'
import FormatShapes from '@mui/icons-material/FormatShapes'
import GridGoldenratio from '@mui/icons-material/GridGoldenratio'
import HighlightAlt from '@mui/icons-material/HighlightAlt'
import PanToolOutlined from '@mui/icons-material/PanToolOutlined'
import Polyline from '@mui/icons-material/Polyline'
import ZoomIn from '@mui/icons-material/ZoomIn'
import ZoomOut from '@mui/icons-material/ZoomOut'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Point } from '../model/geometry'
import { useEditorStore } from '../store/editorStore'
import { PlanCanvas } from './PlanCanvas'
import { usePlanStore, zoomAt, type PlanMode } from './planStore'

const MODES: { mode: PlanMode; icon: React.ReactNode; key: string }[] = [
  { mode: 'select', icon: <HighlightAlt fontSize="small" />, key: 'V' },
  { mode: 'pan', icon: <PanToolOutlined fontSize="small" />, key: 'H' },
  { mode: 'wall', icon: <Polyline fontSize="small" />, key: 'W' },
  { mode: 'room', icon: <FormatShapes fontSize="small" />, key: 'R' },
]

/** 2D-Plan mit Werkzeugleiste und Statuszeile. */
export function PlanPanel() {
  const { t } = useTranslation()
  const hasHome = useEditorStore((s) => s.home !== null)
  const { mode, setMode, magnetism, setMagnetism, view, setView, requestFit } = usePlanStore()
  const [status, setStatus] = useState<{ cursor: Point | null; hint: string }>({ cursor: null, hint: '' })
  const areaRef = useRef<HTMLDivElement>(null)

  // Tastenkürzel für die Werkzeuge (wie die Buchstaben in den Tooltips)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea') || event.ctrlKey || event.metaKey || event.altKey) return
      const match = MODES.find((m) => m.key.toLowerCase() === event.key.toLowerCase())
      if (match) setMode(match.mode)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setMode])

  const zoom = (factor: number) => {
    const rect = areaRef.current?.getBoundingClientRect()
    setView(zoomAt(view, factor, (rect?.width ?? 0) / 2, (rect?.height ?? 0) / 2))
  }
  const onStatus = useCallback((next: { cursor: Point | null; hint: string }) => setStatus(next), [])

  if (!hasHome) return null
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, value: PlanMode | null) => value && setMode(value)}>
          {MODES.map(({ mode: m, icon, key }) => (
            <ToggleButton key={m} value={m} aria-label={t(`plan.modes.${m}`)} sx={{ px: 1, py: 0.5 }}>
              <Tooltip title={`${t(`plan.modes.${m}`)} (${key})`}>
                <Box sx={{ display: 'flex' }}>{icon}</Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <Tooltip title={t('plan.zoomIn')}>
          <IconButton size="small" onClick={() => zoom(1.25)} aria-label={t('plan.zoomIn')}>
            <ZoomIn fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('plan.zoomOut')}>
          <IconButton size="small" onClick={() => zoom(0.8)} aria-label={t('plan.zoomOut')}>
            <ZoomOut fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('plan.fit')}>
          <IconButton size="small" onClick={requestFit} aria-label={t('plan.fit')}>
            <FitScreen fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('plan.magnetism')}>
          <ToggleButton
            size="small"
            value="magnetism"
            selected={magnetism}
            onChange={() => setMagnetism(!magnetism)}
            aria-label={t('plan.magnetism')}
            sx={{ px: 1, py: 0.5, border: 0 }}
          >
            <GridGoldenratio fontSize="small" />
          </ToggleButton>
        </Tooltip>
      </Box>
      <Box ref={areaRef} sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <PlanCanvas onStatus={onStatus} />
      </Box>
      <Box sx={{ display: 'flex', gap: 2, px: 1, py: 0.25, borderTop: 1, borderColor: 'divider', color: 'text.secondary' }}>
        <Typography variant="caption" noWrap sx={{ flex: 1 }}>
          {status.hint}
        </Typography>
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {status.cursor ? `x ${Math.round(status.cursor[0])} · y ${Math.round(status.cursor[1])} cm · ` : ''}
          {Math.round(view.scale * 100)} %
        </Typography>
      </Box>
    </Box>
  )
}
