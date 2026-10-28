export const PANEL_IDS = ['catalog', 'furniture', 'plan', 'view3d'] as const

export type PanelId = (typeof PANEL_IDS)[number]

export function isPanelId(value: string): value is PanelId {
  return (PANEL_IDS as readonly string[]).includes(value)
}
