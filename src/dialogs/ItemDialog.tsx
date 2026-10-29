import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HomeCommand } from '../model/commands'
import { dimensionLength } from '../model/geometry'
import type { DimensionLine, HomePiece, Room, Wall } from '../model/home'
import { executeCommand, useEditorStore } from '../store/editorStore'
import { collectChanges, DEFAULT_SURFACE, degrees, useCheckField, useNumberField, useSurfaceField, useTextField, show, wide } from './fields'
import { Grid } from './layout'
import { useLabelFields } from './labelFields'

function usePieceFields(pieces: HomePiece[]) {
  const { t } = useTranslation()
  const positive = { min: 0, exclusiveMin: true }
  const main = [
    useNumberField(pieces, 'X', (p) => p.x, (c, v) => (c.x = v!)),
    useNumberField(pieces, 'Y', (p) => p.y, (c, v) => (c.y = v!)),
    useNumberField(pieces, t('dialogs.elevation'), (p) => p.elevation, (c, v) => (c.elevation = v!), { min: 0 }),
    useNumberField(pieces, t('dialogs.angle'), (p) => p.angle, (c, v) => (c.angle = v!), degrees),
    useNumberField(pieces, t('furniture.width'), (p) => p.width, (c, v) => (c.width = v!), positive),
    useNumberField(pieces, t('furniture.depth'), (p) => p.depth, (c, v) => (c.depth = v!), positive),
    useNumberField(pieces, t('furniture.height'), (p) => p.height, (c, v) => (c.height = v!), positive),
    useCheckField(pieces, t('furniture.visible'), (p) => p.visible, (c, v) => (c.visible = v)),
  ]
  const name = useTextField(pieces, t('furniture.name'), (p) => p.name, (c, v) => (c.name = v), { required: true })
  const surface = useSurfaceField(
    pieces,
    t('dialogs.surface.piece'),
    (p) => ({ color: p.color, texture: p.texture ?? null }),
    (c, s) => {
      c.color = s.color
      c.texture = s.texture
    },
  )
  const node = (
    <Grid>
      <Box sx={{ gridColumn: '1 / -1' }}>{name.node}</Box>
      {show(main)}
      <Box sx={{ gridColumn: '1 / -1' }}>{surface.node}</Box>
    </Grid>
  )
  return { fields: [name, ...main, surface], node }
}

function useWallFields(walls: Wall[]) {
  const { t } = useTranslation()
  const wallHeight = useEditorStore((s) => s.home!.wallHeight)
  const main = [
    useNumberField(walls, t('dialogs.thickness'), (w) => w.thickness, (c, v) => (c.thickness = v!), { min: 0, exclusiveMin: true }),
    useNumberField(walls, t('furniture.height'), (w) => w.height, (c, v) => (c.height = v), {
      nullable: true,
      min: 0,
      exclusiveMin: true,
      placeholder: String(wallHeight),
    }),
  ]
  const sides = [
    useSurfaceField(walls, t('dialogs.surface.leftSide'), (w) => w.leftSide ?? DEFAULT_SURFACE, (c, s) => (c.leftSide = s)),
    useSurfaceField(walls, t('dialogs.surface.rightSide'), (w) => w.rightSide ?? DEFAULT_SURFACE, (c, s) => (c.rightSide = s)),
  ]
  const node = (
    <Grid>
      {show(main)}
      {wide(sides)}
    </Grid>
  )
  return { fields: [...main, ...sides], node }
}

function useRoomFields(rooms: Room[]) {
  const { t } = useTranslation()
  const name = useTextField(rooms, t('furniture.name'), (r) => r.name, (c, v) => (c.name = v.trim() || null))
  const checks = [
    useCheckField(rooms, t('dialogs.floorVisible'), (r) => r.floorVisible, (c, v) => (c.floorVisible = v)),
    useCheckField(rooms, t('dialogs.ceilingVisible'), (r) => r.ceilingVisible, (c, v) => (c.ceilingVisible = v)),
  ]
  const surfaces = [
    useSurfaceField(rooms, t('dialogs.surface.floor'), (r) => r.floor ?? DEFAULT_SURFACE, (c, s) => (c.floor = s)),
    useSurfaceField(rooms, t('dialogs.surface.ceiling'), (r) => r.ceiling ?? DEFAULT_SURFACE, (c, s) => (c.ceiling = s)),
  ]
  const node = (
    <Grid>
      <Box sx={{ gridColumn: '1 / -1' }}>{name.node}</Box>
      {show(checks)}
      {wide(surfaces)}
    </Grid>
  )
  return { fields: [name, ...checks, ...surfaces], node }
}

function useDimensionFields(lines: DimensionLine[]) {
  const { t } = useTranslation()
  const fields = [
    useNumberField(lines, t('dialogs.length'), dimensionLength, (c, length, line) => {
      // Wie in Sweet Home 3D bleibt der Anfang, das Ende rückt auf der Linie
      const scale = length! / (dimensionLength(line) || 1)
      c.xEnd = line.xStart + (line.xEnd - line.xStart) * scale
      c.yEnd = line.yStart + (line.yEnd - line.yStart) * scale
    }, { min: 0, exclusiveMin: true }),
    useNumberField(lines, t('dialogs.offset'), (d) => d.offset, (c, v) => (c.offset = v!)),
  ]
  return { fields, node: <Grid>{show(fields)}</Grid> }
}

/** Eigenschaften der ausgewählten Objekte; bei gemischter Auswahl je Art ein Abschnitt. */
export function ItemDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { t } = useTranslation()
  // Stand beim Öffnen; Änderungen anderer Fenster in der Zwischenzeit werden überschrieben
  const [items] = useState(() => {
    const home = useEditorStore.getState().home!
    const selected = new Set(ids)
    const pick = <T extends { id: string }>(list: T[]) => list.filter((i) => selected.has(i.id))
    return {
      furniture: pick(home.furniture),
      walls: pick(home.walls),
      rooms: pick(home.rooms),
      labels: pick(home.labels),
      dimensionLines: pick(home.dimensionLines),
    }
  })
  const pieces = usePieceFields(items.furniture)
  const walls = useWallFields(items.walls)
  const rooms = useRoomFields(items.rooms)
  const labels = useLabelFields(items.labels)
  const dimensions = useDimensionFields(items.dimensionLines)

  const sections = [
    { key: 'furniture', items: items.furniture, ...pieces, title: t('dialogs.titles.furniture') },
    { key: 'walls', items: items.walls, ...walls, title: t('dialogs.titles.walls') },
    { key: 'rooms', items: items.rooms, ...rooms, title: t('dialogs.titles.rooms') },
    { key: 'labels', items: items.labels, ...labels, title: t('dialogs.titles.labels') },
    { key: 'dimensionLines', items: items.dimensionLines, ...dimensions, title: t('dialogs.titles.dimensionLines') },
  ].filter((s) => s.items.length > 0)
  const valid = sections.every((s) => s.fields.every((f) => f.valid))

  const save = () => {
    if (!valid) return
    const commands: HomeCommand[] = [
      { type: 'updateFurniture', changes: collectChanges(items.furniture, pieces.fields) },
      { type: 'updateWalls', changes: collectChanges(items.walls, walls.fields) },
      { type: 'updateRooms', changes: collectChanges(items.rooms, rooms.fields) },
      { type: 'updateLabels', changes: collectChanges(items.labels, labels.fields) },
      { type: 'updateDimensionLines', changes: collectChanges(items.dimensionLines, dimensions.fields) },
    ]
    const changed = commands.filter((c) => 'changes' in c && c.changes.length > 0)
    if (changed.length > 0) executeCommand(changed.length === 1 ? changed[0] : { type: 'batch', commands: changed })
    onClose()
  }

  if (sections.length === 0) return null
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <DialogTitle>{sections.length === 1 ? `${sections[0].title} (${sections[0].items.length})` : t('dialogs.titles.mixed')}</DialogTitle>
        <DialogContent>
          {sections.map((section, i) => (
            <Box key={section.key} sx={{ pt: 1 }}>
              {sections.length > 1 && (
                <>
                  {i > 0 && <Divider sx={{ mb: 1.5 }} />}
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {section.title} ({section.items.length})
                  </Typography>
                </>
              )}
              {section.node}
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('projects.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid}>
            {t('dialogs.ok')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
