import ChairOutlined from '@mui/icons-material/ChairOutlined'
import ListAltOutlined from '@mui/icons-material/ListAltOutlined'
import SquareFootOutlined from '@mui/icons-material/SquareFootOutlined'
import ViewInArOutlined from '@mui/icons-material/ViewInArOutlined'
import type { ComponentType, ReactNode } from 'react'
import { CatalogPanel } from '../catalog/CatalogPanel'
import { FurnitureListPanel } from '../furniture/FurnitureListPanel'
import { PlanPanel } from '../plan/PlanPanel'
import { View3DPanel } from '../view3d/View3DPanel'
import type { PanelId } from './panelIds'

interface PanelDefinition {
  titleKey: `panels.${PanelId}`
  icon: ReactNode
  Component: ComponentType
}

export const PANELS: Record<PanelId, PanelDefinition> = {
  catalog: { titleKey: 'panels.catalog', icon: <ChairOutlined fontSize="small" />, Component: CatalogPanel },
  furniture: { titleKey: 'panels.furniture', icon: <ListAltOutlined fontSize="small" />, Component: FurnitureListPanel },
  plan: { titleKey: 'panels.plan', icon: <SquareFootOutlined fontSize="small" />, Component: PlanPanel },
  view3d: { titleKey: 'panels.view3d', icon: <ViewInArOutlined fontSize="small" />, Component: View3DPanel },
}
