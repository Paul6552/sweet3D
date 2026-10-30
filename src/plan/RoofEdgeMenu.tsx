import Divider from '@mui/material/Divider'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { useTranslation } from 'react-i18next'
import { openItemDialog } from '../dialogs/dialogStore'
import { edgeKind, profileFor, rawRoofModel, type EdgeKind } from '../model/roofs'
import { executeCommand, useEditorStore } from '../store/editorStore'

/** Rechtsklick auf eine Ecke bzw. Kante des ausgewählten Dachs (Bildschirmposition x, y). */
export interface RoofMenuTarget {
  x: number
  y: number
  roofId: string
  kind: 'point' | 'edge'
  index: number
}

export function RoofEdgeMenu({ target, onClose }: { target: RoofMenuTarget; onClose: () => void }) {
  const { t } = useTranslation()
  const home = useEditorStore((s) => s.home)
  const roof = home?.roofs.find((r) => r.id === target.roofId)
  if (!home || !roof) return null

  const setKind = (kind: EdgeKind) => {
    const model = rawRoofModel(home, roof)
    const edges = roof.edges.map((edge, i) => (i === target.index ? { ...edge, profile: profileFor(roof, kind, model.ridge - model.eave) } : edge))
    executeCommand({ type: 'updateRoofs', changes: [{ id: roof.id, edges, shape: 'custom' }] })
    onClose()
  }
  const deletePoint = () => {
    // Die Kante davor reicht nun bis zur nächsten Ecke
    const points = roof.points.filter((_, i) => i !== target.index)
    const edges = roof.edges.filter((_, i) => i !== target.index)
    executeCommand({ type: 'updateRoofs', changes: [{ id: roof.id, points, edges }] })
    onClose()
  }
  const current = target.kind === 'edge' ? edgeKind(roof, roof.edges[target.index]) : null
  return (
    <Menu open onClose={onClose} anchorReference="anchorPosition" anchorPosition={{ top: target.y, left: target.x }}>
      {target.kind === 'edge'
        ? (['eave', 'gable', 'halfHip'] as const).map((kind) => (
            <MenuItem key={kind} selected={current === kind} onClick={() => setKind(kind)} dense>
              <ListItemText primary={t(`roof.edgeKinds.${kind}`)} />
            </MenuItem>
          ))
        : [
            <MenuItem key="delete" onClick={deletePoint} disabled={roof.points.length <= 3} dense>
              <ListItemText primary={t('roof.deletePoint')} />
            </MenuItem>,
          ]}
      <Divider />
      <MenuItem
        dense
        onClick={() => {
          onClose()
          openItemDialog([roof.id])
        }}
      >
        <ListItemText primary={t('roof.properties')} />
      </MenuItem>
    </Menu>
  )
}
