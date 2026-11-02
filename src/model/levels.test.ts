import { describe, expect, it } from 'vitest'
import { applyCommand } from './commands'
import { createEmptyHome, type Home, type Room } from './home'
import { DEFAULT_FLOOR_THICKNESS, newBasementLevel, newLevels, newRoofLevel } from './levels'
import { houseFootprint } from './terrain'

const basementName = (n: number) => `UG ${n}`

function addBasement(home: Home) {
  const { levels, base } = newBasementLevel(home, basementName, 'Ebene 0')
  applyCommand(home, { type: 'addLevels', levels, assignExistingTo: base?.id ?? null })
  return levels[levels.length - 1]
}

describe('newBasementLevel', () => {
  it('legt ohne Ebenen zuerst die Ebene 0 an und wählt das Untergeschoss', () => {
    const home = createEmptyHome()
    const basement = addBasement(home)
    expect(home.levels.map((l) => l.name)).toEqual(['UG 1', 'Ebene 0'])
    expect(basement.elevation).toBe(-(home.wallHeight + DEFAULT_FLOOR_THICKNESS))
    expect(home.selectedLevel).toBe(basement.id)
  })

  it('stapelt weitere Untergeschosse nach unten, jedes als eigene Ebene', () => {
    const home = createEmptyHome()
    const first = addBasement(home)
    const second = addBasement(home)
    expect(second.name).toBe('UG 2')
    expect(second.elevation).toBe(first.elevation - first.floorThickness - first.height)
    expect(home.levels.map((l) => l.name)).toEqual(['UG 2', 'UG 1', 'Ebene 0'])
  })

  it('lässt das Dach-Niveau oben', () => {
    const home = createEmptyHome()
    const { levels, base } = newLevels(home, (n) => `Ebene ${n}`)
    applyCommand(home, { type: 'addLevels', levels, assignExistingTo: base?.id ?? null })
    const roof = newRoofLevel(home, 'Dach', 'Ebene 0')
    applyCommand(home, { type: 'addLevels', levels: roof.levels, assignExistingTo: null })
    const roofElevation = home.levels.find((l) => l.roof)!.elevation
    addBasement(home)
    expect(home.levels[0].name).toBe('UG 1')
    expect(home.levels.at(-1)!.roof).toBe(true)
    expect(home.levels.at(-1)!.elevation).toBe(roofElevation)
  })
})

describe('houseFootprint', () => {
  const room = (level: string, points: [number, number][]): Room =>
    ({ id: `room-${level}`, name: null, points, floorVisible: true, ceilingVisible: true, level }) as Room

  it('öffnet den Rasen nur über sichtbaren Untergeschossen', () => {
    const home = createEmptyHome()
    const basement = addBasement(home)
    const ground = home.levels.find((l) => l.elevation === 0)!
    home.rooms.push(room(basement.id, [[0, 0], [400, 0], [400, 300], [0, 300]]), room(ground.id, [[1000, 0], [1400, 0], [1400, 300], [1000, 300]]))
    home.selectedLevel = ground.id
    const holes = houseFootprint(home, 0)
    expect(holes).toHaveLength(1)
    expect(holes[0][0]).toContainEqual([400, 300])

    basement.viewable = false
    expect(houseFootprint(home, 0)).toEqual([])
  })
})
