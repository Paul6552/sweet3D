import Cottage from '@mui/icons-material/Cottage'
import EditOutlined from '@mui/icons-material/EditOutlined'
import FitScreen from '@mui/icons-material/FitScreen'
import FormatShapes from '@mui/icons-material/FormatShapes'
import GridGoldenratio from '@mui/icons-material/GridGoldenratio'
import HighlightAlt from '@mui/icons-material/HighlightAlt'
import PanToolOutlined from '@mui/icons-material/PanToolOutlined'
import Polyline from '@mui/icons-material/Polyline'
import Roofing from '@mui/icons-material/Roofing'
import Straighten from '@mui/icons-material/Straighten'
import TextFields from '@mui/icons-material/TextFields'
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
import { isDialogOpen, openItemDialog } from '../dialogs/dialogStore'
import { roofLevel } from '../model/levels'
import { roofTool } from '../model/roofs'
import { useNotify } from '../editor/useNotify'
import { dispatch, executeCommand, useEditorStore } from '../store/editorStore'
import { PanelToolbar } from '../editor/PanelFrame'
import { LevelTabs } from './LevelTabs'
import { PlanCanvas } from './PlanCanvas'
import { RoofShapeBar } from './RoofShapeBar'
import { usePlanStore, zoomAt, type PlanMode } from './planStore'

// „roof“ ist kein Werkzeug, sondern legt das Dach gleich an
const MODES: { mode: PlanMode | 'roof'; icon: React.ReactNode; key: string }[] = [
  { mode: 'select', icon: <HighlightAlt fontSize="small" />, key: 'V' },
  { mode: 'pan', icon: <PanToolOutlined fontSize="small" />, key: 'H' },
  { mode: 'wall', icon: <Polyline fontSize="small" />, key: 'W' },
  { mode: 'room', icon: <FormatShapes fontSize="small" />, key: 'R' },
  { mode: 'roof', icon: <Roofing fontSize="small" />, key: 'D' },
  { mode: 'dormer', icon: <Cottage fontSize="small" />, key: 'G' },
  { mode: 'dimension', icon: <Straighten fontSize="small" />, key: 'M' },
  { mode: 'label', icon: <TextFields fontSize="small" />, key: 'T' },
]

/** 2D-Plan mit Werkzeugleiste und Statuszeile. */
export function PlanPanel() {
  const { t } = useTranslation()
  const hasHome = useEditorStore((s) => s.home !== null)
  const selection = useEditorStore((s) => s.selection)
  const { mode, setMode, magnetism, setMagnetism, view, setView, requestFit } = usePlanStore()
  const [status, setStatus] = useState<{ cursor: Point | null; hint: string }>({ cursor: null, hint: '' })
  const areaRef = useRef<HTMLDivElement>(null)
  const notify = useNotify()

  // Dach und Gauben gehören auf das Dach-Niveau. Das Dach-Symbol wechselt dorthin (legt es bei Bedarf
  // an) und legt über jedem Haus des Geschosses darunter ein Dach an, falls dort noch keins liegt
  const chooseMode = useCallback(
    (next: PlanMode | 'roof') => {
      const home = useEditorStore.getState().home!
      if (next === 'roof') {
        const { command, levelId, roofIds } = roofTool(home, { roof: t('levels.roofName'), base: t('levels.defaultName', { n: 0 }) })
        // Neue Dächer kommen auf die gewählte Ebene: erst wechseln, dann anlegen
        if (levelId && home.selectedLevel !== levelId && roofLevel(home)) dispatch({ type: 'selectLevel', id: levelId })
        if (command) executeCommand(command)
        dispatch({ type: 'select', ids: roofIds })
        if (roofIds.length === 0) notify(t('plan.noHouse'))
        setMode('select')
        return
      }
      if (next === 'dormer') {
        const level = roofLevel(home)
        if (level && home.selectedLevel !== level.id) dispatch({ type: 'selectLevel', id: level.id })
      }
      setMode(next)
    },
    [setMode, t, notify],
  )

  // Tastenkürzel für die Werkzeuge (wie die Buchstaben in den Tooltips)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Nicht reagieren, wenn die 3D-Ansicht die Tasten bekommt (W/A/S/D für den Besucher)
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [data-view3d]') || event.ctrlKey || event.metaKey || event.altKey || isDialogOpen()) return
      const match = MODES.find((m) => m.key.toLowerCase() === event.key.toLowerCase())
      if (match) chooseMode(match.mode)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chooseMode])

  const zoom = (factor: number) => {
    const rect = areaRef.current?.getBoundingClientRect()
    setView(zoomAt(view, factor, (rect?.width ?? 0) / 2, (rect?.height ?? 0) / 2))
  }
  const onStatus = useCallback((next: { cursor: Point | null; hint: string }) => setStatus(next), [])

  if (!hasHome) return null
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelToolbar>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, value: PlanMode | 'roof' | null) => value && chooseMode(value)}>
          {MODES.map(({ mode: m, icon, key }) => (
            <ToggleButton key={m} value={m} aria-label={t(`plan.modes.${m}`)} sx={{ px: 1, py: 0.5 }}>
              <Tooltip title={`${t(`plan.modes.${m}`)} (${key})`}>
                <Box sx={{ display: 'flex' }}>{icon}</Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Tooltip title={t('plan.modify')}>
          <span>
            <IconButton size="small" disabled={selection.length === 0} onClick={() => openItemDialog(selection)} aria-label={t('plan.modify')}>
              <EditOutlined fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
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
      </PanelToolbar>
      <LevelTabs />
      <Box ref={areaRef} sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <PlanCanvas onStatus={onStatus} />
        <RoofShapeBar />
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
