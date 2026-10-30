import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Roof, RoofEdge, RoofShape } from '../model/home'
import { defaultWallHeight } from '../model/levels'
import { computeRoof, edgeKind, GABLE, profileFor, ROOF_SHAPES, roofAreas, shapeEdges, type EdgeKind } from '../model/roofs'
import { NumberInput, ProfileEditor, RoofPreview } from './RoofEditors'
import { toDegrees, toRadians } from './roofUnits'
import { useEditorStore } from '../store/editorStore'
import { DEFAULT_SURFACE, degrees, sharedValue, useCheckField, useNumberField, useSurfaceField, useTextField, show, wide, type Field } from './fields'
import { Grid } from './layout'

const MAX_SLOPE = toRadians(89)

/**
 * Dachform und Kanten: Bei einem einzelnen Dach eine Tabelle der Kanten mit Art, Neigung, Überstand und
 * Profil und ein Grundriss zur Orientierung; bei mehreren Dächern nur die Dachform.
 */
function useShapeField(roofs: Roof[]): Field<Roof> {
  const { t } = useTranslation()
  const home = useEditorStore((s) => s.home!)
  const single = roofs.length === 1 ? roofs[0] : null
  const sharedShape = sharedValue(roofs, (r) => r.shape)
  const [shape, setShape] = useState<RoofShape | ''>(sharedShape ?? '')
  const [edges, setEdges] = useState<RoofEdge[]>(single?.edges ?? [])
  const [edgesDirty, setEdgesDirty] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)
  const wallHeight = single ? defaultWallHeight(home, single.level) : 0
  const current = single ? { ...single, edges, shape: shape || single.shape } : null
  const model = useMemo(() => (current ? computeRoof(current, { wallHeight }) : null), [current?.edges, current?.shape, wallHeight]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = (shape !== '' && shape !== sharedShape) || edgesDirty

  const chooseShape = (next: RoofShape) => {
    setShape(next)
    if (single && next !== 'custom') {
      setEdges(shapeEdges({ ...single, edges }, next).edges)
      setEdgesDirty(true)
    }
  }
  const changeEdge = (index: number, edge: RoofEdge) => {
    setEdges(edges.map((e, i) => (i === index ? edge : e)))
    setEdgesDirty(true)
    setShape('custom')
  }
  const ridgeHeight = model ? model.ridge - model.eave : 0
  const lengths = single?.points.map((a, i) => {
    const b = single.points[(i + 1) % single.points.length]
    return Math.hypot(b[0] - a[0], b[1] - a[1])
  })
  const areas = model ? roofAreas(model) : null

  const node = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <TextField select size="small" label={t('roof.shape')} value={shape} onChange={(e) => chooseShape(e.target.value as RoofShape)} slotProps={{ inputLabel: { shrink: true } }}>
        {[...ROOF_SHAPES, ...(shape === 'custom' ? (['custom'] as const) : [])].map((s) => (
          <MenuItem key={s} value={s}>
            {t(`roof.shapes.${s}`)}
          </MenuItem>
        ))}
      </TextField>
      {single && model && current && (
        <>
          <RoofPreview model={model} highlight={highlight} />
          {areas && (
            <Typography variant="caption" color="text.secondary">
              {t('roof.summary', {
                ridge: Math.round(model.ridge),
                area: (areas.true / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 }),
                plan: (areas.plan / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 }),
              })}
            </Typography>
          )}
          <Typography variant="subtitle2">{t('roof.edges')}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {edges.map((edge, i) => {
              const kind = edgeKind(current, edge)
              const profile = edge.profile ?? [{ height: null, slope: current.slope }]
              return (
                <Box
                  key={i}
                  onMouseEnter={() => setHighlight(i)}
                  onFocus={() => setHighlight(i)}
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    bgcolor: highlight === i ? 'action.selected' : undefined,
                  }}
                >
                  <Typography variant="body2" sx={{ width: 24, fontWeight: 600 }}>
                    {i + 1}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ width: 64 }}>
                    {Math.round(lengths![i])} cm
                  </Typography>
                  <TextField
                    select
                    size="small"
                    variant="standard"
                    value={kind}
                    sx={{ width: 140 }}
                    onChange={(e) => {
                      const next = e.target.value as EdgeKind | 'custom'
                      const nextProfile =
                        next === 'custom'
                          ? [
                              { height: Math.round(ridgeHeight * 0.4) || 100, slope: toRadians(60) },
                              { height: null, slope: toRadians(30) },
                            ]
                          : profileFor(current, next, ridgeHeight)
                      changeEdge(i, { ...edge, profile: nextProfile })
                    }}
                  >
                    {(['eave', 'gable', 'halfHip', 'custom'] as const).map((k) => (
                      <MenuItem key={k} value={k}>
                        {t(`roof.edgeKinds.${k}`)}
                      </MenuItem>
                    ))}
                  </TextField>
                  {kind === 'eave' && (
                    <NumberInput
                      value={edge.profile ? profile[0].slope : null}
                      placeholder={String(toDegrees(current.slope))}
                      unit="°"
                      angle
                      onChange={(v) => changeEdge(i, { ...edge, profile: v === null ? null : [{ height: null, slope: Math.min(v, MAX_SLOPE) }] })}
                    />
                  )}
                  {kind === 'halfHip' && (
                    <>
                      <NumberInput value={profile[0].height} unit="cm" onChange={(v) => v !== null && changeEdge(i, { ...edge, profile: [{ height: v, slope: GABLE }, profile[1]] })} />
                      <NumberInput value={profile[1].slope} unit="°" angle onChange={(v) => changeEdge(i, { ...edge, profile: [profile[0], { height: null, slope: Math.min(v ?? current.slope, MAX_SLOPE) }] })} />
                    </>
                  )}
                  <Tooltip title={t('roof.overhang')}>
                    <span>
                      <NumberInput value={edge.overhang} placeholder={String(current.overhang)} unit="cm" onChange={(v) => changeEdge(i, { ...edge, overhang: v })} />
                    </span>
                  </Tooltip>
                  {kind === 'custom' && (
                    <Box sx={{ width: '100%', pl: 4 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('roof.profile')}
                      </Typography>
                      <ProfileEditor profile={profile} roofSlope={current.slope} onChange={(p) => changeEdge(i, { ...edge, profile: p })} />
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </>
      )}
    </Box>
  )
  return {
    node,
    dirty,
    valid: true,
    apply: (change, item) => {
      const merged = { ...item, ...change }
      if (single && edgesDirty) {
        change.edges = edges
        change.shape = shape || 'custom'
        if (shape === 'flat') change.slope = 0
        return
      }
      if (!shape) return
      const result = shapeEdges(merged, shape)
      change.shape = shape
      change.edges = result.edges
      if (shape === 'flat' || merged.slope < toRadians(0.5)) change.slope = result.slope
    },
  }
}

/** Eigenschaften der ausgewählten Dächer. */
export function useRoofFields(roofs: Roof[]) {
  const { t } = useTranslation()
  const home = useEditorStore((s) => s.home!)
  const wallHeight = defaultWallHeight(home, roofs[0]?.level ?? null)
  const name = useTextField(roofs, t('furniture.name'), (r) => r.name, (c, v) => (c.name = v.trim() || null))
  const numbers = [
    useNumberField(roofs, t('roof.baseHeight'), (r) => r.baseHeight, (c, v) => (c.baseHeight = v), { nullable: true, min: 0, placeholder: String(wallHeight) }),
    useNumberField(
      roofs,
      t('roof.slope'),
      (r) => r.slope,
      (c, v, roof) => {
        c.slope = Math.min(v!, MAX_SLOPE)
        // Vorlagen mit Profilen (z. B. Krüppelwalm) folgen der neuen Neigung
        if (roof.shape !== 'custom' && roof.shape !== 'flat') c.edges = shapeEdges({ ...roof, slope: c.slope }, roof.shape).edges
      },
      { ...degrees, min: 0 },
    ),
    useNumberField(roofs, t('roof.overhang'), (r) => r.overhang, (c, v) => (c.overhang = v!), { min: 0 }),
    useNumberField(roofs, t('roof.thickness'), (r) => r.thickness, (c, v) => (c.thickness = v!), { min: 0, exclusiveMin: true }),
    useNumberField(roofs, t('roof.maxHeight'), (r) => r.maxHeight, (c, v) => (c.maxHeight = v), { nullable: true, min: 0, exclusiveMin: true }),
    useNumberField(roofs, t('roof.parapet'), (r) => r.parapet, (c, v) => (c.parapet = v), { nullable: true, min: 0 }),
  ]
  const visible = useCheckField(roofs, t('furniture.visible'), (r) => r.visible, (c, v) => (c.visible = v))
  const shape = useShapeField(roofs)
  const surfaces = [
    useSurfaceField(roofs, t('roof.top'), (r) => r.top ?? DEFAULT_SURFACE, (c, s) => (c.top = s)),
    useSurfaceField(roofs, t('roof.underside'), (r) => r.underside ?? DEFAULT_SURFACE, (c, s) => (c.underside = s)),
    useSurfaceField(roofs, t('roof.sides'), (r) => r.sides ?? DEFAULT_SURFACE, (c, s) => (c.sides = s)),
  ]
  const node = (
    <Grid>
      <Box sx={{ gridColumn: '1 / -1' }}>{name.node}</Box>
      {show(numbers)}
      {visible.node}
      <Box sx={{ gridColumn: '1 / -1' }}>{shape.node}</Box>
      {wide(surfaces)}
    </Grid>
  )
  // Die Form zuletzt, damit sie die neue Neigung kennt
  return { fields: [name, ...numbers, visible, ...surfaces, shape], node }
}
