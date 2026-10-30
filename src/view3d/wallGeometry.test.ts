import { describe, expect, it } from 'vitest'
import { wallPolygon } from '../model/geometry'
import { createEmptyHome, type HomePiece, type Wall } from '../model/home'
import { computeRoof, createRoof, shapeEdges, wallCaps } from '../model/roofs'
import { wallSlices, type WallSlice } from './wallGeometry'

const deg = (d: number) => (d * Math.PI) / 180

function wall(xStart: number, yStart: number, xEnd: number, yEnd: number): Wall {
  return { id: `wall-${xStart}-${yStart}`, xStart, yStart, xEnd, yEnd, wallAtStart: null, wallAtEnd: null, thickness: 20, height: null, level: null, toRoof: true }
}

/** Höchste und niedrigste Höhe der Oberkante (Szenenhöhe = Oberkante der Scheibe − z). */
function heights(slices: WallSlice[]) {
  let max = -Infinity
  for (const slice of slices) {
    const position = slice.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) max = Math.max(max, slice.top - position.getZ(i))
  }
  return max
}

/** Satteldach 1200 × 800 mit Giebeln an den kurzen Seiten (x = 0 und x = 1200). */
function setup() {
  const home = createEmptyHome()
  const base = { ...createRoof([[0, 0], [1200, 0], [1200, 800], [0, 800]], null, 'gable'), slope: deg(40), overhang: 50, thickness: 20 }
  const roof = { ...base, ...shapeEdges(base, 'gable') }
  home.roofs = [roof]
  const models = new Map([[roof.id, computeRoof(roof, { wallHeight: 250 })]])
  const slices = (w: Wall, pieces: HomePiece[] = []) =>
    wallSlices(w, 250, pieces, new Map([[w.id, w]]), 0, wallCaps(home, models, null, wallPolygon(w, new Map([[w.id, w]])), 250))
  return { slices }
}

describe('Wände bis zum Dach', () => {
  it('Giebelwand reicht bis unter den First', () => {
    const { slices } = setup()
    expect(heights(slices(wall(10, 0, 10, 800)))).toBeCloseTo(250 + 400 * Math.tan(deg(40)), 0)
  })

  it('Traufwand endet an der Unterseite', () => {
    const { slices } = setup()
    // Außen in Traufhöhe, innen 20 cm weiter die Neigung hinauf
    expect(heights(slices(wall(0, 10, 1200, 10)))).toBeCloseTo(250 + 20 * Math.tan(deg(40)), 0)
  })

  it('Wand außerhalb des Dachs behält ihre Höhe, Öffnungen bleiben erhalten', () => {
    const { slices } = setup()
    expect(heights(slices(wall(2000, 0, 2000, 800)))).toBeCloseTo(250, 5)
    const window = { x: 10, y: 400, angle: Math.PI / 2, width: 100, depth: 20, height: 100, elevation: 300, visible: true } as HomePiece
    const withWindow = slices(wall(10, 0, 10, 800), [window])
    // Scheibengrenzen an Unter- und Oberkante des Fensters im Giebel
    expect(withWindow.some((s) => s.bottom === 300)).toBe(true)
    expect(withWindow.some((s) => s.top === 400)).toBe(true)
  })
})
