import Paper from '@mui/material/Paper'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import { useTranslation } from 'react-i18next'
import type { RoofShape } from '../model/home'
import { ROOF_SHAPES, shapeEdges } from '../model/roofs'
import { executeCommand, useEditorStore } from '../store/editorStore'

/** Ansicht von vorn je Dachform (Dach gefüllt, darunter das Haus). */
const SILHOUETTES: Record<Exclude<RoofShape, 'custom'>, string> = {
  gable: 'M2 14 L12 4 L22 14 Z',
  hip: 'M2 14 L8 6 L16 6 L22 14 Z',
  halfHip: 'M2 14 L9 7 L12 4.5 L15 7 L22 14 Z M9 7 L15 7',
  shed: 'M2 14 L2 10 L22 5 L22 14 Z',
  flat: 'M2 14 L2 10 L4 10 L4 12 L20 12 L20 10 L22 10 L22 14 Z',
  mansard: 'M2 14 L4.5 7 L12 4 L19.5 7 L22 14 Z',
  mansardHip: 'M2 14 L4.5 7 L9 5 L15 5 L19.5 7 L22 14 Z',
  barrel: 'M2 14 Q2 4 12 4 Q22 4 22 14 Z',
}

function ShapeIcon({ shape }: { shape: Exclude<RoofShape, 'custom'> }) {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
      <path d={SILHOUETTES[shape]} fill="currentColor" fillOpacity={0.85} stroke="currentColor" strokeWidth={0.8} strokeLinejoin="round" />
      <rect x={4.5} y={14} width={15} height={7} fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  )
}

/** Leiste über dem Plan zum Wechseln der Dachform des ausgewählten Dachs. */
export function RoofShapeBar() {
  const { t } = useTranslation()
  const roof = useEditorStore((s) => (s.selection.length === 1 ? s.home?.roofs.find((r) => r.id === s.selection[0]) : undefined))
  if (!roof) return null
  return (
    <Paper elevation={3} sx={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={roof.shape}
        aria-label={t('roof.shapeBar')}
        onChange={(_, shape: RoofShape | null) => {
          if (!shape || shape === roof.shape) return
          executeCommand({ type: 'updateRoofs', changes: [{ id: roof.id, ...shapeEdges(roof, shape) }] })
        }}
      >
        {ROOF_SHAPES.map((shape) => (
          <ToggleButton key={shape} value={shape} aria-label={t(`roof.shapes.${shape}`)} sx={{ px: 0.75, py: 0.25 }}>
            <Tooltip title={t(`roof.shapes.${shape}`)}>
              <span style={{ display: 'flex' }}>
                <ShapeIcon shape={shape as Exclude<RoofShape, 'custom'>} />
              </span>
            </Tooltip>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Paper>
  )
}
