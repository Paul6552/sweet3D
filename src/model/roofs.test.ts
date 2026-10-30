import { describe, expect, it } from 'vitest'
import type { Point } from './geometry'
import type { Roof } from './home'
import { cleanRing, computeRoof, cornerIndices, createDormer, createRoof, edgeKind, rawRoofModel, gableEdges, linearZ, roofAreas, roofHeightAt, roofHeightsAlong, roofModels, shapeEdges, skylightHole, skylightPlacement, wallCaps, type RoofModel } from './roofs'
import { pointInPolygon, polygonArea, wallPolygon } from './geometry'
import { createEmptyHome } from './home'
import { newLevels, newRoofLevel } from './levels'
import { applyCommand } from './commands'

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

describe('Gauben', () => {
  it('Schleppgaube: an der Fläche ausgerichtet, Hauptdach offen, Wände stehen auf dem Dach', async () => {
    const { createEmptyHome } = await import('./home')
    const home = createEmptyHome()
    const main = roof(rect(800, 1200), { slope: deg(45) })
    home.roofs = [main]
    // Südfläche (y > 400) steigt nach −y
    const dormer = createDormer(home, main, [400, 700], [600, 500])!
    expect(dormer).not.toBeNull()
    const { roof: d, walls, outline } = dormer
    expect(d.dormer).toEqual({ roofId: main.id, wallIds: walls.map((w) => w.id) })
    expect(walls).toHaveLength(3)
    // Front parallel zur Traufe am weiter unten liegenden Punkt; hinten am Rechteck trifft das Gaubendach
    // das Hauptdach, der Umriss reicht 30 cm darüber
    expect(outline[0][1]).toBeCloseTo(700, 5)
    expect(outline[1][1]).toBeCloseTo(700, 5)
    expect(Math.abs(outline[1][0] - outline[0][0])).toBeCloseTo(200, 5)
    expect(outline[2][1]).toBeCloseTo(470, 5)
    const top = computeRoof(d, { wallHeight: 250 })
    expect(roofHeightAt(top, [500, 505])! - roofHeightAt(computeRoof(main, { wallHeight: 250 }), [500, 505])!).toBeGreaterThan(0)
    expect(roofHeightAt(top, [500, 495])! - roofHeightAt(computeRoof(main, { wallHeight: 250 }), [500, 495])!).toBeLessThan(0)
    home.roofs = [main, d]
    const models = roofModels(home)
    // Öffnung im Hauptdach, Gaubendach endet am Hauptdach
    expect(roofAreas(models.get(main.id)!).plan).toBeLessThan(roofAreas(computeRoof(main, { wallHeight: 250 })).plan - 100 * 100)
    const raw = computeRoof(d, { wallHeight: 250 })
    expect(roofAreas(models.get(d.id)!).plan).toBeLessThan(roofAreas(raw).plan)
    // Frontwand: unten auf der Unterseite des Hauptdachs, oben an der Traufe der Gaube
    const front = walls[1]
    const caps = wallCaps(home, models, null, wallPolygon(front, new Map(walls.map((w) => [w.id, w]))), 250, { model: computeRoof(main, { wallHeight: 250 }), level: null })
    const mid: Point = [(front.xStart + front.xEnd) / 2, (front.yStart + front.yEnd) / 2]
    const cap = caps.find((c) => c.bottom && c.area.some((poly) => pointInPolygon(mid, poly[0] as Point[])))!
    expect(cap).toBeDefined()
    expect(linearZ(cap.height, mid) - linearZ(cap.bottom!, mid)).toBeGreaterThan(140)
    expect(linearZ(cap.bottom!, mid)).toBeCloseTo(roofHeightAt(computeRoof(main, { wallHeight: 250 }), mid, 'bottom')!, 3)
  })

  it('Satteldachgaube: Giebel vorn und hinten', () => {
    const main = roof(rect(800, 1200), { slope: deg(45) })
    const home = { levels: [], wallHeight: 250, roofs: [main] }
    const { roof: d } = createDormer(home, main, [400, 700], [600, 500], 'gable')!
    expect(edgeKind(d, d.edges[0])).toBe('gable')
    expect(edgeKind(d, d.edges[1])).toBe('eave')
    expect(edgeKind(d, d.edges[2])).toBe('gable')
    expect(edgeKind(d, d.edges[3])).toBe('eave')
  })
})

describe('Leicht versetzte Wände', () => {
  // L-förmiges Haus, dessen Nordseite aus mehreren um wenige cm versetzten Wänden besteht
  const outline: Point[] = [
    [-223.4, -416.9], [132.2, -413.2], [217.9, -414.4], [343.3, -412.6], [456.6, -409.6], [505.9, -409.9], [808.4, -409.6], [843.1, -412.2],
    [1255.1, -415.5], [1251.9, 581], [622.7, 581], [610.9, 579.1], [165.7, 577.5], [168.4, 105.9], [-223.2, 100.5], [-223.4, -265.3],
  ]

  it('Ecken sind nur die echten Hausecken', () => {
    expect(cornerIndices(outline)).toEqual([0, 8, 9, 12, 13, 14])
  })

  it('Pultdach: die ganze lange Seite ist Traufe', () => {
    const r = roof(outline, { shape: 'shed' })
    const eaves = r.edges.map((e, i) => (e.profile ? -1 : i)).filter((i) => i >= 0)
    expect(eaves).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // Die Pultfläche steigt über die ganze Tiefe des Hauses
    expect(computeRoof(r, { wallHeight: 250 }).ridge).toBeGreaterThan(250 + 900 * Math.tan(deg(40)))
  })

  it('Keine Dachfläche geht beim Zuschneiden verloren (Rechenfehler von polygon-clipping)', () => {
    const corners = cornerIndices(outline).map((i) => outline[i])
    const r = { ...roof(corners), overhang: 40, thickness: 25 }
    const sloped = r.edges.map((e, i) => (e.profile ? -1 : i)).filter((i) => i >= 0)
    const model = computeRoof(r, { wallHeight: 250 })
    expect(new Set(model.surfaces.map((s) => s.edge))).toEqual(new Set(sloped))
  })

  it('Satteldach: Teilstücke einer Seite bekommen dieselbe Kantenart', () => {
    const r = roof(outline)
    const kinds = r.edges.map((e) => !!e.profile)
    expect(new Set(kinds.slice(0, 8)).size).toBe(1)
    expect(kinds[14]).toBe(kinds[15])
    // Kein Giebel auf einem Teilstück der Nordseite
    expect(kinds[7]).toBe(false)
  })
})

describe('Dach-Niveau', () => {
  it('liegt über dem obersten Niveau, die Traufe auf seinem Fußboden', () => {
    const home = createEmptyHome()
    const { levels, base } = newRoofLevel(home, 'Dach', 'Ebene 0')
    expect(base).not.toBeNull()
    const [ground, roofFloor] = levels
    expect(roofFloor).toMatchObject({ name: 'Dach', roof: true, elevation: ground.elevation + ground.height + roofFloor.floorThickness })
    home.levels = levels
    const r = { ...roof(rect(800, 1200)), level: roofFloor.id }
    expect(rawRoofModel(home, r).eave).toBeCloseTo(0, 5)
    expect(rawRoofModel(home, { ...r, level: ground.id }).eave).toBeCloseTo(ground.height, 5)
  })

  it('wird mit seinen Dächern gelöscht', () => {
    const home = createEmptyHome()
    const { levels } = newRoofLevel(home, 'Dach', 'Ebene 0')
    home.levels = levels
    home.roofs = [{ ...roof(rect(800, 1200)), level: levels[1].id }]
    applyCommand(home, { type: 'deleteLevel', id: levels[1].id })
    expect(home.roofs).toEqual([])
    expect(home.levels.map((l) => l.id)).toEqual([levels[0].id])
  })
})

describe('Neues Geschoss unter dem Dach', () => {
  it('kommt unter das Dach-Niveau, das nach oben rückt; Wände darunter enden an der Decke', () => {
    const home = createEmptyHome()
    home.levels = newRoofLevel(home, 'Dach', 'Ebene 0').levels
    const [ground, roofFloor] = home.levels
    const roofElevation = roofFloor.elevation
    const { levels } = newLevels(home, (n) => `Ebene ${n}`)
    expect(levels[0].elevation).toBe(roofElevation)
    applyCommand(home, { type: 'addLevels', levels, assignExistingTo: null })
    expect(home.levels.map((l) => l.id)).toEqual([ground.id, levels[0].id, roofFloor.id])
    expect(home.levels[2].elevation).toBe(levels[0].elevation + levels[0].height + roofFloor.floorThickness)

    const r = { ...roof(rect(800, 1200)), level: roofFloor.id }
    home.roofs = [r]
    const models = new Map([[r.id, rawRoofModel(home, r)]])
    const outline: Point[] = [[0, 390], [1200, 390], [1200, 410], [0, 410]]
    // Erdgeschoss: kein Dach direkt darüber, also eine waagrechte Oberkante
    expect(wallCaps(home, models, ground.id, outline, 250).map((c) => c.height)).toEqual([[0, 0, 250]])
    // Neues Obergeschoss: reicht bis unter den First
    expect(Math.max(...wallCaps(home, models, levels[0].id, outline, 250).map((c) => c.height[2]))).toBeGreaterThan(250)
  })

  it('Löschen des Geschosses lässt das Dach-Niveau zurückrutschen', () => {
    const home = createEmptyHome()
    home.levels = newRoofLevel(home, 'Dach', 'Ebene 0').levels
    const elevation = home.levels[1].elevation
    const { levels } = newLevels(home, (n) => `Ebene ${n}`)
    applyCommand(home, { type: 'addLevels', levels, assignExistingTo: null })
    applyCommand(home, { type: 'deleteLevel', id: levels[0].id })
    expect(home.levels.find((l) => l.roof)?.elevation).toBe(elevation)
    // Höheres Erdgeschoss hebt das Dach mit
    applyCommand(home, { type: 'updateLevel', change: { id: home.levels[0].id, height: 300 } })
    expect(home.levels.find((l) => l.roof)?.elevation).toBe(elevation + 50)
  })
})
