import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import { useTheme } from '@mui/material/styles'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoofProfileStep } from '../model/home'
import { GABLE, type RoofModel } from '../model/roofs'
import { toDegrees, toRadians } from './roofUnits'

/** Zahl in einem kleinen Feld; leer bedeutet {@code null}. */
export function NumberInput({
  value,
  onChange,
  unit,
  placeholder,
  angle,
  width = 92,
}: {
  value: number | null
  onChange: (value: number | null) => void
  unit: string
  placeholder?: string
  angle?: boolean
  width?: number
}) {
  const show = (v: number | null) => (v === null ? '' : String(angle ? toDegrees(v) : Math.round(v * 10) / 10))
  const [text, setText] = useState(() => show(value))
  // Von außen geänderte Werte (z. B. neue Dachform) übernehmen, ohne beim Tippen zu springen
  useEffect(() => {
    const parsed = Number.parseFloat(text.replace(',', '.'))
    const current = text.trim() === '' ? null : angle ? toRadians(parsed) : parsed
    if (value === null ? current !== null : current === null || Math.abs(current - value) > 1e-6) setText(show(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei neuem Wert von außen
  }, [value])
  return (
    <TextField
      size="small"
      variant="standard"
      value={text}
      placeholder={placeholder}
      sx={{ width }}
      onChange={(e) => {
        setText(e.target.value)
        const parsed = Number.parseFloat(e.target.value.replace(',', '.'))
        if (e.target.value.trim() === '') onChange(null)
        else if (Number.isFinite(parsed) && parsed >= 0) onChange(angle ? Math.min(toRadians(parsed), GABLE) : parsed)
      }}
      slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <Typography variant="caption" color="text.secondary">{unit}</Typography> } }}
    />
  )
}

/** Grundriss des Dachs mit nummerierten Kanten; die Kante {@code highlight} ist hervorgehoben. */
export function RoofPreview({ model, highlight }: { model: RoofModel; highlight: number | null }) {
  const theme = useTheme()
  const outer = model.outline[0]
  if (!outer) return null
  const xs = model.outline.flat().map((p) => p[0])
  const ys = model.outline.flat().map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = Math.max(...xs) - minX || 1
  const h = Math.max(...ys) - minY || 1
  const pad = Math.max(w, h) * 0.08
  const stroke = Math.max(w, h) / 250
  const wall = model.wallLine[0]
  return (
    <Box
      component="svg"
      viewBox={`${minX - pad} ${minY - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      sx={{ width: '100%', height: 170, display: 'block', bgcolor: 'action.hover', borderRadius: 1 }}
    >
      {model.outline.map((ring, i) => (
        <polygon key={i} points={ring.map((p) => p.join(',')).join(' ')} fill={`${theme.palette.warning.main}22`} stroke={theme.palette.text.secondary} strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 2}`} />
      ))}
      {model.lines.map(([a, b], i) => (
        <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={theme.palette.text.primary} strokeWidth={stroke} />
      ))}
      {wall.map((a, k) => {
        const b = wall[(k + 1) % wall.length]
        const index = model.edgeIndex[k]
        const active = index === highlight
        const mx = (a[0] + b[0]) / 2
        const my = (a[1] + b[1]) / 2
        return (
          <g key={k}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={active ? theme.palette.primary.main : theme.palette.text.secondary} strokeWidth={stroke * (active ? 4 : 1.5)} />
            <circle cx={mx} cy={my} r={stroke * 7} fill={active ? theme.palette.primary.main : theme.palette.background.paper} stroke={theme.palette.text.secondary} strokeWidth={stroke * 0.6} />
            <text x={mx} y={my} fontSize={stroke * 8} textAnchor="middle" dominantBaseline="central" fill={active ? theme.palette.primary.contrastText : theme.palette.text.primary}>
              {index + 1}
            </text>
          </g>
        )
      })}
    </Box>
  )
}

/** Abschnitte eines eigenen Profils: bis Höhe · Neigung, der letzte reicht bis oben. */
export function ProfileEditor({ profile, onChange, roofSlope }: { profile: RoofProfileStep[]; onChange: (profile: RoofProfileStep[]) => void; roofSlope: number }) {
  const { t } = useTranslation()
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
      {profile.map((step, k) => (
        <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {k < profile.length - 1 ? (
            <NumberInput value={step.height} unit="cm" width={76} onChange={(v) => onChange(profile.map((s, j) => (j === k ? { ...s, height: v ?? s.height } : s)))} />
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ width: 76 }}>
              {t('roof.toTop')}
            </Typography>
          )}
          <NumberInput value={step.slope} unit="°" angle width={64} onChange={(v) => onChange(profile.map((s, j) => (j === k ? { ...s, slope: v ?? roofSlope } : s)))} />
        </Box>
      ))}
      <Tooltip title={t('roof.addStep')}>
        <IconButton
          size="small"
          onClick={() => {
            // Neuer Abschnitt vor dem letzten, 100 cm über dem vorigen
            const last = profile[profile.length - 1]
            const before = profile.slice(0, -1)
            const height = (before.at(-1)?.height ?? 0) + 100
            onChange([...before, { height, slope: last.slope }, { height: null, slope: Math.max(toRadians(5), last.slope / 2) }])
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {profile.length > 1 && (
        <Tooltip title={t('roof.removeStep')}>
          <IconButton size="small" onClick={() => onChange([...profile.slice(0, -2), { ...profile[profile.length - 2], height: null }])}>
            <RemoveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}
