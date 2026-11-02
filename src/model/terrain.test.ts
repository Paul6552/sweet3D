import { describe, expect, it } from 'vitest'
import { applyCommand } from './commands'
import type { Point } from './geometry'
import { createEmptyHome, type Home, type Room, type TerrainArea } from './home'
import { newLevels } from './levels'
import { DEFAULT_SLOPE_ANGLE, pointInMultiPolygon, slopeReach, terrainFaces, terrainHeightAt, terrainPatches } from './terrain'

const square = (x: number, y: number, size: number): Point[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]]

function area(id: string, points: Point[], elevation: number, edge: TerrainArea['edge'] = 'wall'): TerrainArea {
  return { id, name: null, points, elevation, followLevel: null, edge, slopeAngle: DEFAULT_SLOPE_ANGLE }
}

/** Garage on level 0 in the front, lawn from the height of level 1 behind it. */
function hillside(): { home: Home; upper: string; ground: string } {
  const home = createEmptyHome()
  const { levels, base } = newLevels(home, (n) => `Ebene ${n}`)
  applyCommand(home, { type: 'addLevels', levels, assignExistingTo: base?.id ?? null })
  const [ground, upper] = levels
  home.selectedLevel = ground.id
  home.rooms.push({ id: 'garage', name: null, points: square(0, 0, 600), floorVisible: true, ceilingVisible: true, level: ground.id } as Room)
  // Lawn covers the back half of the plot including the rear part of the garage
  applyCommand(home, { type: 'addItems', terrain: [{ ...area('lawn', [[-1000, 300], [2000, 300], [2000, 2000], [-1000, 2000]], 0), followLevel: upper.id }] })
  return { home, upper: upper.id, ground: ground.id }
}

describe('terrainHeightAt', () => {
  it('nimmt die Höhe der zuletzt gezeichneten Fläche', () => {
    const terrain = [area('a', square(0, 0, 1000), 300), area('b', square(200, 200, 200), 100)]
    expect(terrainHeightAt(terrain, [100, 100])).toBe(300)
    expect(terrainHeightAt(terrain, [300, 300])).toBe(100)
    expect(terrainHeightAt(terrain, [2000, 2000])).toBe(0)
  })

  it('fällt an einer Böschung bis zum Gelände daneben ab', () => {
    const terrain = [area('a', square(0, 0, 1000), 150, 'slope')]
    const tan = Math.tan(DEFAULT_SLOPE_ANGLE)
    expect(terrainHeightAt(terrain, [1000 + 50, 500])).toBeCloseTo(150 - 50 * tan)
    expect(terrainHeightAt(terrain, [1000 + 1000, 500])).toBe(0)
    expect(slopeReach(terrain, 0)).toBeCloseTo(150 / tan, 0)
  })

  it('steigt bei einem Einschnitt bis zum Gelände daneben an', () => {
    const terrain = [area('hill', square(-2000, -2000, 4000), 300), area('cut', square(0, 0, 400), 0, 'slope')]
    const tan = Math.tan(DEFAULT_SLOPE_ANGLE)
    expect(terrainHeightAt(terrain, [200, 200])).toBe(0)
    expect(terrainHeightAt(terrain, [400 + 100, 200])).toBeCloseTo(100 * tan)
    expect(terrainHeightAt(terrain, [1500, 200])).toBe(300)
  })
})

describe('terrainPatches', () => {
  it('ohne Geländeflächen nur der Grundboden mit Löchern über Untergeschossen', () => {
    const home = createEmptyHome()
    const patches = terrainPatches(home)
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({ area: null, kind: 'flat', elevation: 0, houseHoles: [] })
    expect(terrainFaces(home, patches)).toEqual([])
  })

  it('schneidet den Rasen über der Garage aus, die Straße davor nicht', () => {
    const { home } = hillside()
    const patches = terrainPatches(home)
    const lawn = patches.find((p) => p.area === 0)!
    const base = patches.find((p) => p.area === null)!
    expect(lawn.elevation).toBe(home.levels[1].elevation)
    // Rear part of the garage: no lawn, the house holds the terrain
    expect(pointInMultiPolygon([300, 450], lawn.polygons)).toBe(false)
    expect(pointInMultiPolygon([300, 1000], lawn.polygons)).toBe(true)
    // Street in front of the garage and the garage floor: base ground, no hole
    expect(pointInMultiPolygon([300, -200], base.polygons)).toBe(true)
    expect(pointInMultiPolygon([300, 150], base.polygons)).toBe(true)
    expect(pointInMultiPolygon([300, 1000], base.polygons)).toBe(false)
  })

  it('zieht senkrechte Felswände nur außerhalb des Hauses', () => {
    const { home } = hillside()
    const faces = terrainFaces(home, terrainPatches(home))
    const height = home.levels[1].elevation
    expect(faces.length).toBeGreaterThan(0)
    for (const face of faces) {
      expect(face.topA).toBe(height)
      expect(face.bottomA).toBe(0)
      // Never inside the garage (x and y 0…600)
      const mid = [(face.a[0] + face.b[0]) / 2, (face.a[1] + face.b[1]) / 2]
      expect(mid[0] > 0 && mid[0] < 600 && mid[1] > 0 && mid[1] < 600).toBe(false)
    }
    // The front edge of the lawn left and right of the garage
    const front = faces.filter((f) => f.a[1] === 300 && f.b[1] === 300)
    expect(front.reduce((sum, f) => sum + Math.abs(f.b[0] - f.a[0]), 0)).toBeCloseTo(3000 - 600, 0)
  })

  it('folgt der Höhe der Ebene', () => {
    const { home, upper } = hillside()
    applyCommand(home, { type: 'updateLevel', change: { id: upper, elevation: 320 } })
    expect(home.terrain[0].elevation).toBe(320)
    applyCommand(home, { type: 'deleteLevel', id: upper })
    expect(home.terrain[0].followLevel).toBeNull()
    expect(home.terrain[0].elevation).toBe(320)
  })

  it('baut an einer Böschung keine senkrechte Wand', () => {
    const home = createEmptyHome()
    home.terrain.push(area('a', square(0, 0, 1000), 150, 'slope'))
    const patches = terrainPatches(home)
    expect(patches.map((p) => p.kind).sort()).toEqual(['flat', 'flat', 'slope'])
    expect(terrainFaces(home, patches)).toEqual([])
  })
})
