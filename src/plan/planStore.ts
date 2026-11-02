import { create } from 'zustand'

export type PlanMode = 'select' | 'pan' | 'wall' | 'room' | 'terrain' | 'dormer' | 'dimension' | 'label'

export interface PlanView {
  /** Pixel pro cm. */
  scale: number
  /** Bildschirmposition des Planursprungs. */
  x: number
  y: number
}

interface PlanState {
  mode: PlanMode
  magnetism: boolean
  view: PlanView
  /** Größe der Planfläche in Pixeln; 0, solange in diesem Fenster kein Plan angezeigt wird. */
  viewport: { width: number; height: number }
  /** Zähler; jede Erhöhung passt den Plan ins Fenster ein. */
  fitRequest: number
  requestFit: () => void
  setMode: (mode: PlanMode) => void
  setMagnetism: (magnetism: boolean) => void
  setView: (view: PlanView) => void
  setViewport: (viewport: { width: number; height: number }) => void
}

export const MIN_SCALE = 0.05
export const MAX_SCALE = 20

/** Zustand des Planeditors; er gehört zum jeweiligen Fenster und wird nicht synchronisiert. */
export const usePlanStore = create<PlanState>((set) => ({
  mode: 'select',
  magnetism: true,
  view: { scale: 0.5, x: 50, y: 50 },
  viewport: { width: 0, height: 0 },
  fitRequest: 1,
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  setMode: (mode) => set({ mode }),
  setMagnetism: (magnetism) => set({ magnetism }),
  setView: (view) => set({ view: { ...view, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale)) } }),
  setViewport: (viewport) => set({ viewport }),
}))

/** Zoomt um den Faktor {@code factor} so, dass der Bildschirmpunkt (px, py) fest bleibt. */
export function zoomAt(view: PlanView, factor: number, px: number, py: number): PlanView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
  const planX = (px - view.x) / view.scale
  const planY = (py - view.y) / view.scale
  return { scale, x: px - planX * scale, y: py - planY * scale }
}

/** Planpunkt in der Mitte der sichtbaren Planfläche, oder null, wenn in diesem Fenster kein Plan angezeigt wird. */
export function visiblePlanCenter(): [number, number] | null {
  const { view, viewport } = usePlanStore.getState()
  if (viewport.width === 0 || viewport.height === 0) return null
  return [(viewport.width / 2 - view.x) / view.scale, (viewport.height / 2 - view.y) / view.scale]
}
