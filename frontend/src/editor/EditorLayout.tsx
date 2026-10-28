import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import { DetachButton } from './DetachButton'
import { useLayoutStore } from './layoutStore'
import { PanelFrame } from './PanelFrame'
import type { PanelId } from './panelIds'
import { PANELS } from './panels'

// Die Bibliothek setzt flex inline auf 0 0 auto, daher die Größe je Ausrichtung festlegen
const separatorSx = {
  '&[aria-orientation="vertical"]': { width: 4 },
  '&[aria-orientation="horizontal"]': { height: 4 },
  bgcolor: 'divider',
  transition: 'background-color 120ms',
  '&:hover, &[data-separator-state="active"]': { bgcolor: 'primary.main' },
}

function DockedPanel({ panel }: { panel: PanelId }) {
  const { t } = useTranslation()
  const { titleKey, icon, Component } = PANELS[panel]
  return (
    <PanelFrame title={t(titleKey)} icon={icon} actions={<DetachButton panel={panel} />}>
      <Component />
    </PanelFrame>
  )
}

/** Eine Spalte mit bis zu zwei übereinanderliegenden Panels. */
function Column({ panels, id }: { panels: PanelId[]; id: string }) {
  if (panels.length === 1) return <DockedPanel panel={panels[0]} />
  return (
    <Group orientation="vertical" id={id}>
      <Panel id={panels[0]} minSize={80}>
        <DockedPanel panel={panels[0]} />
      </Panel>
      <Box component={Separator} sx={separatorSx} />
      <Panel id={panels[1]} minSize={80}>
        <DockedPanel panel={panels[1]} />
      </Panel>
    </Group>
  )
}

/**
 * Anordnung wie in Sweet Home 3D: links Katalog und Möbelliste, rechts Plan und 3D-Ansicht.
 * Herausgelöste Panels fehlen hier, die übrigen teilen sich den Platz.
 */
export function EditorLayout() {
  const { t } = useTranslation()
  const detached = useLayoutStore((s) => s.detached)
  const left = (['catalog', 'furniture'] as const).filter((p) => !detached.includes(p))
  const right = (['plan', 'view3d'] as const).filter((p) => !detached.includes(p))

  if (left.length === 0 && right.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Typography color="text.secondary">{t('panels.detachedHint')}</Typography>
      </Box>
    )
  }
  if (left.length === 0 || right.length === 0) {
    const panels = left.length === 0 ? right : left
    return <Column key={panels.join()} panels={panels} id={`column-${panels.join()}`} />
  }
  // Der Key setzt die Aufteilung zurück, wenn sich die sichtbaren Panels ändern
  return (
    <Group orientation="horizontal" key={[...left, ...right].join()} id="editor-main">
      <Panel id="left" defaultSize="28" minSize={220}>
        <Column panels={left} id={`left-${left.join()}`} />
      </Panel>
      <Box component={Separator} sx={separatorSx} />
      <Panel id="right" minSize={300}>
        <Column panels={right} id={`right-${right.join()}`} />
      </Panel>
    </Group>
  )
}
