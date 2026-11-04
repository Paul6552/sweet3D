import { describe, expect, it } from 'vitest'
import { applyCommand } from './commands'
import type { Point } from './geometry'
import { createEmptyHome, type Home, type Room, type TerrainArea } from './home'
import { newLevels } from './levels'
import { areaBottom, areaTop, DEFAULT_SLOPE_ANGLE, defaultRampAngle, patchHeight, pointInMultiPolygon, rampHeight, slopeReach, terrainFaces, terrainHeightAt, terrainPatches } from './terrain'

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

  it('schließt den Rasen an einem Raum ohne Wände mit einer Felswand bis zu dessen Boden ab', () => {
    const { home } = hillside()
    const faces = terrainFaces(home, terrainPatches(home))
    // Rear edge (y = 600) and sides (x = 0, x = 600) of the garage within the lawn
    const along = (test: (f: (typeof faces)[number]) => boolean) => faces.filter(test).reduce((sum, f) => sum + Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), 0)
    expect(along((f) => f.a[1] === 600 && f.b[1] === 600)).toBeCloseTo(600, 0)
    expect(along((f) => f.a[0] === 0 && f.b[0] === 0)).toBeCloseTo(300, 0)
    expect(along((f) => f.a[0] === 600 && f.b[0] === 600)).toBeCloseTo(300, 0)
  })

  it('baut entlang der Wände des Hauses keine Felswand', () => {
    const { home, ground } = hillside()
    const corners = square(0, 0, 600)
    corners.forEach(([x, y], i) => {
      const [xEnd, yEnd] = corners[(i + 1) % 4]
      home.walls.push({ id: `w${i}`, xStart: x, yStart: y, xEnd, yEnd, wallAtStart: `w${(i + 3) % 4}`, wallAtEnd: `w${(i + 1) % 4}`, thickness: 20, height: null, level: ground })
    })
    const faces = terrainFaces(home, terrainPatches(home))
    for (const face of faces) {
      const mid = [(face.a[0] + face.b[0]) / 2, (face.a[1] + face.b[1]) / 2]
      expect(mid[0] > -20 && mid[0] < 620 && mid[1] > 290 && mid[1] < 620).toBe(false)
    }
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

describe('Schräge', () => {
  /** Rises from 0 at x = 0 to 300 at x = 1000. */
  const ramp = (edge: TerrainArea['edge'] = 'wall'): TerrainArea => ({ ...area('ramp', square(0, 0, 1000), 300, edge), rampAngle: 0 })

  it('steigt linear von der unteren auf die obere Höhe', () => {
    const terrain = [ramp()]
    expect(terrainHeightAt(terrain, [1, 500])).toBeCloseTo(0.3)
    expect(terrainHeightAt(terrain, [500, 500])).toBeCloseTo(150)
    expect(terrainHeightAt(terrain, [999, 500])).toBeCloseTo(299.7)
    expect(terrainHeightAt(terrain, [1100, 500])).toBe(0)
  })

  it('beginnt auf der eingestellten unteren Höhe', () => {
    const terrain = [{ ...ramp(), rampLow: 100 }]
    expect(terrainHeightAt(terrain, [500, 500])).toBeCloseTo(200)
    expect(areaTop(terrain[0])).toBe(300)
    expect(areaBottom(terrain[0])).toBe(100)
  })

  it('folgt einer beliebigen Richtung', () => {
    const diagonal = { ...ramp(), rampAngle: Math.PI / 4 }
    expect(rampHeight(diagonal, [0, 0])).toBeCloseTo(0)
    expect(rampHeight(diagonal, [1000, 1000])).toBeCloseTo(300)
    expect(rampHeight(diagonal, [1000, 0])).toBeCloseTo(150)
    expect(rampHeight({ ...ramp(), rampAngle: Math.PI }, [0, 500])).toBeCloseTo(300)
  })

  it('nimmt die erste Kante als Fuß und steigt ins Innere an, egal in welchem Drehsinn', () => {
    const points = square(0, 0, 1000)
    expect(rampHeight({ ...ramp(), rampAngle: defaultRampAngle(points) }, [500, 1000])).toBeCloseTo(300)
    expect(rampHeight({ ...ramp(), rampAngle: defaultRampAngle(points) }, [500, 0])).toBeCloseTo(0)
    const reversed = [...points].reverse()
    // Its first edge runs along y = 1000
    expect(rampHeight({ ...ramp(), points: reversed, rampAngle: defaultRampAngle(reversed) }, [500, 1000])).toBeCloseTo(0)
    expect(rampHeight({ ...ramp(), points: reversed, rampAngle: defaultRampAngle(reversed) }, [500, 0])).toBeCloseTo(300)
  })

  it('bleibt beim Verschieben gleich geneigt', () => {
    const home = createEmptyHome()
    home.terrain.push(ramp())
    applyCommand(home, { type: 'moveItems', ids: ['ramp'], dx: 2000, dy: 0 })
    expect(terrainHeightAt(home.terrain, [2500, 500])).toBeCloseTo(150)
  })

  it('liefert auch auf dem Umriss die Höhe der Schräge', () => {
    const home = createEmptyHome()
    home.terrain.push(ramp())
    const patch = terrainPatches(home).find((p) => p.area === 0)!
    expect(patch.kind).toBe('ramp')
    expect(patchHeight(home, patch, [1000, 0])).toBeCloseTo(300)
    expect(patchHeight(home, patch, [500, 1000])).toBeCloseTo(150)
  })

  it('baut am Fuß keine Felswand, seitlich wächst sie mit der Schräge', () => {
    const home = createEmptyHome()
    home.terrain.push(ramp())
    const faces = terrainFaces(home, terrainPatches(home))
    expect(faces.filter((f) => f.a[0] === 0 && f.b[0] === 0)).toEqual([])
    const high = faces.filter((f) => f.a[0] === 1000 && f.b[0] === 1000)
    expect(high.length).toBeGreaterThan(0)
    for (const face of high) expect(face.topA).toBeCloseTo(300)
    const side = faces.filter((f) => f.a[1] === 0 && f.b[1] === 0)
    expect(side.length).toBeGreaterThan(0)
    for (const face of side) {
      expect(face.topA).toBeCloseTo(face.a[0] * 0.3)
      expect(face.bottomA).toBe(0)
    }
  })

  it('läuft mit Böschung zum Fuß hin aus', () => {
    const terrain = [ramp('slope')]
    const tan = Math.tan(DEFAULT_SLOPE_ANGLE)
    expect(slopeReach(terrain, 0)).toBeCloseTo(300 / tan, 0)
    expect(terrainHeightAt(terrain, [1000 + 50, 500])).toBeCloseTo(300 - 50 * tan)
    expect(terrainHeightAt(terrain, [500, -50])).toBeCloseTo(150 - 50 * tan)
    expect(terrainHeightAt(terrain, [-50, 500])).toBe(0)
    const home = createEmptyHome()
    home.terrain.push(ramp('slope'))
    const patches = terrainPatches(home)
    expect(patches.map((p) => p.kind).sort()).toEqual(['flat', 'ramp', 'slope'])
    expect(terrainFaces(home, patches)).toEqual([])
  })

  it('schneidet das Haus bis zur oberen Höhe aus', () => {
    const { home } = hillside()
    home.terrain[0] = { ...home.terrain[0], rampAngle: Math.PI / 2 }
    const patch = terrainPatches(home).find((p) => p.area === 0)!
    expect(patch.kind).toBe('ramp')
    expect(pointInMultiPolygon([300, 450], patch.polygons)).toBe(false)
    expect(pointInMultiPolygon([300, 1000], patch.polygons)).toBe(true)
  })
})

describe('Folgt dem Gelände', () => {
  const asphalt = { color: 0xff404040, texture: null }
  const hill = (edge: TerrainArea['edge'] = 'wall'): TerrainArea => ({ ...area('hill', square(0, 0, 1000), 300, edge), rampAngle: 0 })
  /** Strip from y = 400 to 600, reaching beyond the hill on both sides. */
  const road = (): TerrainArea => ({ ...area('road', [[-500, 400], [1500, 400], [1500, 600], [-500, 600]], 999), drape: true, surface: asphalt })
  const withTerrain = (...terrain: TerrainArea[]): Home => ({ ...createEmptyHome(), terrain })

  it('ändert keine Höhen', () => {
    for (const point of [[500, 500], [-100, 500], [1100, 500], [500, 100]] as Point[]) {
      expect(terrainHeightAt([hill('slope'), road()], point)).toBe(terrainHeightAt([hill('slope')], point))
    }
  })

  it('legt die Oberfläche auf die Schräge, ohne deren Höhen zu ändern', () => {
    const home = withTerrain(hill(), road())
    const part = terrainPatches(home).find((p) => p.area === 0 && p.surface === asphalt)!
    expect(part.kind).toBe('ramp')
    expect(pointInMultiPolygon([500, 500], part.polygons)).toBe(true)
    expect(pointInMultiPolygon([500, 100], part.polygons)).toBe(false)
    expect(patchHeight(home, part, [500, 500])).toBeCloseTo(150)
  })

  it('läuft über Schräge, Böschung und Grundboden hinweg', () => {
    const home = withTerrain(hill('slope'), road())
    const parts = terrainPatches(home).filter((p) => p.surface === asphalt)
    expect(parts.map((p) => p.kind).sort()).toEqual(['flat', 'ramp', 'slope'])
    expect(parts.find((p) => p.kind === 'flat')!.area).toBeNull()
    // The rest of each patch keeps the ground
    expect(terrainPatches(home).filter((p) => !p.surface).map((p) => p.kind).sort()).toEqual(['flat', 'ramp', 'slope'])
  })

  it('baut keine zusätzlichen Felswände', () => {
    const faces = (home: Home) => terrainFaces(home, terrainPatches(home))
    const length = (list: ReturnType<typeof faces>) => list.reduce((sum, f) => sum + Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), 0)
    expect(length(faces(withTerrain(hill(), road())))).toBeCloseTo(length(faces(withTerrain(hill()))), 0)
    expect(faces(withTerrain(hill('slope'), road()))).toEqual([])
  })

  it('liegt unter später gezeichneten Flächen und über früheren', () => {
    const terrace = area('terrace', square(400, 400, 200), 50)
    const later = terrainPatches(withTerrain(road(), terrace)).find((p) => p.area === 1)!
    expect(later.surface).toBeNull()
    const earlier = terrainPatches(withTerrain(terrace, road())).find((p) => p.area === 0)!
    expect(earlier.surface).toBe(asphalt)
  })

  it('ohne eigene Oberfläche bleibt alles beim Alten', () => {
    const home = withTerrain(hill(), { ...road(), surface: { color: null, texture: null } })
    expect(terrainPatches(home)).toEqual(terrainPatches(withTerrain(hill())))
  })
})
