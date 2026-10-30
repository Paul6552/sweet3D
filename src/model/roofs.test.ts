import { describe, expect, it } from 'vitest'
import type { Point } from './geometry'
import type { Roof } from './home'
import { cleanRing, computeRoof, createRoof, gableEdges, roofAreas, roofHeightAt, roofHeightsAlong, shapeEdges, skylightHole, skylightPlacement, type RoofModel } from './roofs'
import { polygonArea } from './geometry'

const deg = (d: number) => (d * Math.PI) / 180
const rect = (w: number, l: number): Point[] => [
  [0, 0],
  [l, 0],
  [l, w],
  [0, w],
]

function roof(points: Point[], changes: Partial<Roof> = {}): Roof {
  const base: Roof = { ...createRoof(points, null, 'gable'), slope: deg(40), overhang: 50, thickness: 20, ...changes }
  return { ...base, ...shapeEdges(base, changes.shape ?? 'gable') }
}

const planArea = (model: RoofModel) => roofAreas(model).plan

describe('computeRoof', () => {
  it('Satteldach mit Überstand: First, Fläche und Traufe', () => {
    const r = roof(rect(800, 1200))
    const model = computeRoof(r, { wallHeight: 250 })
    const t = 20 / Math.cos(deg(40))
    expect(model.ridge).toBeCloseTo(250 + t + 400 * Math.tan(deg(40)), 3)
    // Überstand an allen Seiten, auch am Ortgang
    expect(planArea(model)).toBeCloseTo((800 + 100) * (1200 + 100), -1)
    // Unterseite trifft die Wandlinie in Traufhöhe
    expect(roofHeightAt(model, [600, 0.01], 'bottom')).toBeCloseTo(250, 1)
    // Am Rand des Überstands liegt die Unterseite um 50·tan40 tiefer
    expect(roofHeightAt(model, [600, -49.99], 'bottom')).toBeCloseTo(250 - 50 * Math.tan(deg(40)), 1)
  })

  it('Walmdach: vier Flächen, Grundriss gleich Umriss mit Überstand', () => {
    const model = computeRoof(roof(rect(800, 1200), { shape: 'hip' }), { wallHeight: 250 })
    expect(model.surfaces).toHaveLength(4)
    expect(planArea(model)).toBeCloseTo(900 * 1300, -1)
  })

  it('Flachdach mit Attika', () => {
    const model = computeRoof(roof(rect(800, 1200), { shape: 'flat', parapet: 80 }), { wallHeight: 250 })
    expect(model.flat).toBe(true)
    expect(model.surfaces).toHaveLength(1)
    expect(model.ridge).toBeCloseTo(270, 5)
    expect(model.parapet?.top).toBeCloseTo(350, 5)
  })

  it('alle Vorlagen liefern geschlossene Dächer', () => {
    const l: Point[] = [
      [0, 0],
      [1200, 0],
      [1200, 600],
      [600, 600],
      [600, 1400],
      [0, 1400],
    ]
    for (const shape of ['flat', 'shed', 'gable', 'hip', 'halfHip', 'mansard', 'mansardHip', 'barrel'] as const) {
      for (const points of [rect(800, 1200), l]) {
        const model = computeRoof(roof(points, { shape, overhang: 0 }), { wallHeight: 250 })
        const area = points.length === 4 ? 800 * 1200 : 1200 * 600 + 600 * 800
        expect(planArea(model), `${shape} auf ${points.length} Ecken`).toBeCloseTo(area, -1)
      }
    }
  })

  it('Satteldach auf L-Form mit kurzem Flügel und Überstand', () => {
    const short: Point[] = [
      [0, 0],
      [1600, 0],
      [1600, 600],
      [720, 600],
      [720, 1000],
      [0, 1000],
    ]
    for (const overhang of [0, 40]) {
      const model = computeRoof(roof(short, { shape: 'gable', overhang, thickness: 25, slope: deg(35) }), { wallHeight: 250 })
      const o = overhang
      const area = (1600 + 2 * o) * (600 + 2 * o) + (720 + 2 * o) * (400)
      expect(planArea(model), `Überstand ${o}`).toBeCloseTo(area, -1)
    }
  })

  it('Mansarddach: Unterseite folgt dem Profil', () => {
    const r = roof(rect(1000, 1400), { shape: 'mansardHip', overhang: 0 })
    const model = computeRoof(r, { wallHeight: 250 })
    const steep = r.edges[0].profile![0]
    const d = steep.height! / Math.tan(steep.slope)
    // Am Knick (d nach innen) liegt die Unterseite auf Traufe + Profilhöhe
    expect(roofHeightAt(model, [700, d - 0.01], 'bottom')).toBeCloseTo(250 + steep.height!, 0)
  })

  it('Öffnungen schneiden die Fläche aus', () => {
    const r = roof(rect(800, 1200), { overhang: 0 })
    const hole = [[[500, 100], [700, 100], [700, 300], [500, 300], [500, 100]]] as [number, number][][]
    const model = computeRoof(r, { wallHeight: 250, holes: [hole] })
    expect(planArea(model)).toBeCloseTo(800 * 1200 - 200 * 200, -1)
    expect(roofHeightAt(model, [600, 200])).toBeNull()
  })

  it('Höhenverlauf der Unterseite entlang einer Giebelwand', () => {
    const r = roof(rect(800, 1200), { overhang: 0 })
    const model = computeRoof(r, { wallHeight: 250 })
    // Giebel rechts bei x = 1200, Wandachse leicht innen
    const pieces = roofHeightsAlong(model, [1190, 0], [1190, 800])
    expect(pieces.length).toBeGreaterThanOrEqual(2)
    const top = Math.max(...pieces.flatMap((p) => [p.z0, p.z1]))
    expect(top).toBeCloseTo(250 + 400 * Math.tan(deg(40)), 0)
  })
})

describe('Hilfsfunktionen', () => {
  it('cleanRing entfernt doppelte Punkte und Punkte auf Geraden', () => {
    const { points, source } = cleanRing([
      [0, 0],
      [500, 0],
      [1000, 0],
      [1000, 0.1],
      [1000, 800],
      [0, 800],
    ])
    expect(points).toHaveLength(4)
    expect(source).toEqual([0, 3, 4, 5])
  })

  it('gableEdges findet die kurzen Enden', () => {
    expect([...gableEdges(rect(800, 1200))].sort()).toEqual([1, 3])
    const l: Point[] = [
      [0, 0],
      [1200, 0],
      [1200, 600],
      [600, 600],
      [600, 1400],
      [0, 1400],
    ]
    expect([...gableEdges(l)].sort()).toEqual([1, 4])
    // Kurzer Flügel: auch sein Ende wird Giebel
    const short: Point[] = [
      [0, 0],
      [1600, 0],
      [1600, 600],
      [720, 600],
      [720, 1000],
      [0, 1000],
    ]
    expect([...gableEdges(short)].sort()).toEqual([1, 4])
    expect([...gableEdges(rect(1000, 1000))].sort()).toEqual([1, 3])
  })
})

describe('Dachfenster', () => {
  it('liegt in der Fläche, Oberkante zum First, und folgt Änderungen am Dach', async () => {
    const { createEmptyHome } = await import('./home')
    const { applyCommand } = await import('./commands')
    const { pitchedSize } = await import('./geometry')
    const home = createEmptyHome()
    const r = roof(rect(800, 1200))
    home.roofs = [r]
    const window = { x: 600, y: 200, width: 80, depth: 10, height: 120, angle: 0, level: null }
    const placement = skylightPlacement(home, window)!
    expect(placement.roofId).toBe(r.id)
    // Nordfläche steigt nach +y: lokal −y zeigt hinauf, also Drehung um 180°
    expect(placement.angle).toBeCloseTo(Math.PI, 6)
    expect(placement.pitch).toBeCloseTo(Math.PI / 2 - deg(40), 6)
    const offset = 20 / Math.cos(deg(40))
    const center = 250 + 200 * Math.tan(deg(40)) + offset / 2
    expect(placement.elevation + pitchedSize({ ...window, pitch: placement.pitch }).height / 2).toBeCloseTo(center, 0)
    // Öffnung im Plan: Breite × Höhe · cos(Neigung)
    const hole = skylightHole({ ...window, ...placement } as never)
    expect(Math.abs(polygonArea(hole))).toBeCloseTo(80 * 120 * Math.cos(deg(40)), 3)

    home.furniture = [{ ...window, ...placement, id: 'w' } as never]
    applyCommand(home, { type: 'updateRoofs', changes: [{ id: r.id, ...shapeEdges({ ...r, slope: deg(30) }, 'gable'), slope: deg(30) }] })
    expect(home.furniture[0].pitch).toBeCloseTo(Math.PI / 2 - deg(30), 6)
  })
})
