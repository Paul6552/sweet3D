import { describe, expect, it } from 'vitest'
import type { Point } from './geometry'
import { straightSkeleton, type Point3, type SkeletonFace, type SkeletonStep } from './roofSkeleton'

const deg = (d: number) => (d * Math.PI) / 180
const GABLE = Math.PI / 2

/** Fläche im Grundriss mit Vorzeichen. */
function planArea(polygon: (Point | Point3)[]): number {
  let sum = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) sum += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1]
  return sum / 2
}

const uniform = (ring: Point[], slope: number, z = 0): SkeletonStep[][] => ring.map(() => [{ z, d: 0, slope }])

function sloped(faces: SkeletonFace[]) {
  return faces.filter((f) => Math.abs(f.plane.c) > 1e-9)
}

/** Grundrissfläche aller geneigten Flächen und der flachen Reste. */
function coveredArea(result: ReturnType<typeof straightSkeleton>) {
  return sloped(result.faces).reduce((s, f) => s + Math.abs(planArea(f.polygon)), 0) + result.top.reduce((s, r) => s + planArea(r), 0)
}

function maxZ(faces: SkeletonFace[]) {
  return Math.max(...faces.flatMap((f) => f.polygon.map((p) => p[2])))
}

function expectPlanar(faces: SkeletonFace[]) {
  for (const face of faces) {
    for (const [x, y, z] of face.polygon) {
      const { a, b, c, d } = face.plane
      expect(Math.abs(a * x + b * y + c * z - d)).toBeLessThan(1e-4)
    }
  }
}

const rectangle = (w: number, l: number): Point[] => [
  [0, 0],
  [l, 0],
  [l, w],
  [0, w],
]

describe('straightSkeleton', () => {
  it('Walmdach auf einem Rechteck', () => {
    const ring = rectangle(800, 1200)
    const result = straightSkeleton([ring], [uniform(ring, deg(45))], 0)
    expect(sloped(result.faces)).toHaveLength(4)
    expect(maxZ(result.faces)).toBeCloseTo(400, 4)
    expect(coveredArea(result)).toBeCloseTo(800 * 1200, 0)
    expectPlanar(result.faces)
  })

  it('Satteldach: First in Höhe b/2·tanα', () => {
    const ring = rectangle(800, 1200)
    const steps = [ring.map((_, i): SkeletonStep[] => [{ z: 0, d: 0, slope: i % 2 === 0 ? deg(30) : GABLE }])]
    const result = straightSkeleton([ring], steps, 0)
    const roof = sloped(result.faces)
    expect(roof).toHaveLength(2)
    expect(maxZ(result.faces)).toBeCloseTo(400 * Math.tan(deg(30)), 4)
    expect(coveredArea(result)).toBeCloseTo(800 * 1200, 0)
    // Jede Dachfläche ist ein Rechteck über die halbe Breite
    for (const face of roof) expect(Math.abs(planArea(face.polygon))).toBeCloseTo(400 * 1200, 0)
    expectPlanar(result.faces)
  })

  it('Zeltdach auf einem Quadrat endet in einer Spitze', () => {
    const ring = rectangle(1000, 1000)
    const result = straightSkeleton([ring], [uniform(ring, deg(40))], 0)
    expect(sloped(result.faces)).toHaveLength(4)
    expect(maxZ(result.faces)).toBeCloseTo(500 * Math.tan(deg(40)), 4)
    expect(coveredArea(result)).toBeCloseTo(1e6, 0)
  })

  it('Pultdach: eine Traufe, sonst Giebel', () => {
    const ring = rectangle(600, 1000)
    const steps = [ring.map((_, i): SkeletonStep[] => [{ z: 0, d: 0, slope: i === 0 ? deg(15) : GABLE }])]
    const result = straightSkeleton([ring], steps, 0)
    expect(sloped(result.faces)).toHaveLength(1)
    expect(maxZ(result.faces)).toBeCloseTo(600 * Math.tan(deg(15)), 4)
    expect(coveredArea(result)).toBeCloseTo(6e5, 0)
  })

  it('L-Form mit Kehle', () => {
    const ring: Point[] = [
      [0, 0],
      [1200, 0],
      [1200, 600],
      [600, 600],
      [600, 1400],
      [0, 1400],
    ]
    const result = straightSkeleton([ring], [uniform(ring, deg(45))], 0)
    const area = 1200 * 600 + 600 * 800
    expect(sloped(result.faces)).toHaveLength(6)
    expect(coveredArea(result)).toBeCloseTo(area, 0)
    expect(maxZ(result.faces)).toBeCloseTo(300, 4)
    expectPlanar(result.faces)
  })

  it('T-Form', () => {
    const ring: Point[] = [
      [0, 0],
      [1500, 0],
      [1500, 500],
      [1000, 500],
      [1000, 1300],
      [500, 1300],
      [500, 500],
      [0, 500],
    ]
    const result = straightSkeleton([ring], [uniform(ring, deg(40))], 0)
    expect(coveredArea(result)).toBeCloseTo(1500 * 500 + 500 * 800, 0)
    expectPlanar(result.faces)
  })

  it('Innenhof', () => {
    const outer = rectangle(2000, 2000)
    const hole: Point[] = [
      [600, 600],
      [1400, 600],
      [1400, 1400],
      [600, 1400],
    ]
    const result = straightSkeleton([outer, hole], [uniform(outer, deg(35)), uniform(hole, deg(35))], 0)
    expect(sloped(result.faces)).toHaveLength(8)
    expect(coveredArea(result)).toBeCloseTo(2000 * 2000 - 800 * 800, 0)
    expect(maxZ(result.faces)).toBeCloseTo(300 * Math.tan(deg(35)), 4)
  })

  it('Mansardwalmdach: Knick in der Profilhöhe', () => {
    const ring = rectangle(1000, 1400)
    const h = 200
    const d = h / Math.tan(deg(70))
    const steps = [ring.map((): SkeletonStep[] => [{ z: 0, d: 0, slope: deg(70) }, { z: h, d, slope: deg(30) }])]
    const result = straightSkeleton([ring], steps, 0)
    expect(sloped(result.faces)).toHaveLength(8)
    expect(maxZ(result.faces)).toBeCloseTo(h + (500 - d) * Math.tan(deg(30)), 3)
    expect(coveredArea(result)).toBeCloseTo(1.4e6, 0)
    expectPlanar(result.faces)
  })

  it('Krüppelwalmdach: unten Giebel, oben Walm', () => {
    const ring = rectangle(800, 1200)
    const ridge = 400
    const steps = [
      ring.map((_, i): SkeletonStep[] => (i % 2 === 0 ? [{ z: 0, d: 0, slope: deg(45) }] : [{ z: 0, d: 0, slope: GABLE }, { z: 250, d: 0, slope: deg(45) }])),
    ]
    const result = straightSkeleton([ring], steps, 0)
    expect(maxZ(result.faces)).toBeCloseTo(ridge, 4)
    // Zwei Hauptflächen und zwei kleine Walme
    expect(sloped(result.faces)).toHaveLength(4)
    expect(coveredArea(result)).toBeCloseTo(800 * 1200, 0)
  })

  it('Höhenbegrenzung lässt oben eine flache Fläche', () => {
    const ring = rectangle(800, 1200)
    const result = straightSkeleton([ring], [uniform(ring, deg(45))], 0, 200)
    expect(result.top).toHaveLength(1)
    expect(planArea(result.top[0])).toBeCloseTo(400 * 800, 0)
    expect(coveredArea(result)).toBeCloseTo(800 * 1200, 0)
  })

  it('unterschiedliche Neigungen je Kante', () => {
    const ring = rectangle(800, 1200)
    const steps = [ring.map((_, i): SkeletonStep[] => [{ z: 0, d: 0, slope: deg([30, 50, 40, 60][i]) }])]
    const result = straightSkeleton([ring], steps, 0)
    expect(coveredArea(result)).toBeCloseTo(800 * 1200, 0)
    expectPlanar(result.faces)
  })

  it('flachere parallele Kante überholt die steilere', () => {
    // Untere Kante abgestuft: links flach (30°), rechts steil (45°), 50 cm weiter innen
    const ring: Point[] = [
      [0, 0],
      [600, 0],
      [600, 50],
      [1600, 50],
      [1600, 800],
      [0, 800],
    ]
    const slopes = [30, 45, 45, 30, 30, 30]
    const result = straightSkeleton([ring], [ring.map((_, i): SkeletonStep[] => [{ z: 0, d: 0, slope: deg(slopes[i]) }])], 0)
    // Ab z = 50/(√3 − 1) bestimmt die flache Kante die ganze Unterseite: First wie beim Rechteck 0..800
    expect(maxZ(result.faces)).toBeCloseTo(400 * Math.tan(deg(30)), 3)
    expect(coveredArea(result)).toBeCloseTo(1600 * 800 - 1000 * 50, 0)
    expectPlanar(result.faces)
  })

  it('Umlaufsinn der Eingabe ist egal', () => {
    const ring = [...rectangle(800, 1200)].reverse()
    const result = straightSkeleton([ring], [uniform(ring, deg(45))], 0)
    expect(coveredArea(result)).toBeCloseTo(800 * 1200, 0)
  })

  it('stürzt bei Punkten auf einer Geraden und sehr nahen Punkten nicht ab', () => {
    const ring: Point[] = [
      [0, 0],
      [500, 0],
      [1000, 0],
      [1000, 0.0001],
      [1000, 800],
      [0, 800],
    ]
    expect(() => straightSkeleton([ring], [uniform(ring, deg(45))], 0)).not.toThrow()
  })

  it('U-Form und unregelmäßiges Vieleck', () => {
    const u: Point[] = [
      [0, 0],
      [1500, 0],
      [1500, 1200],
      [1000, 1200],
      [1000, 500],
      [500, 500],
      [500, 1200],
      [0, 1200],
    ]
    const result = straightSkeleton([u], [uniform(u, deg(40))], 0)
    expect(coveredArea(result)).toBeCloseTo(1500 * 1200 - 500 * 700, 0)
    const odd: Point[] = [
      [0, 0],
      [900, -100],
      [1300, 400],
      [1000, 700],
      [1100, 1100],
      [300, 900],
      [-200, 500],
    ]
    const result2 = straightSkeleton([odd], [uniform(odd, deg(35))], 0)
    expect(coveredArea(result2)).toBeCloseTo(planArea(odd), 0)
    expectPlanar(result2.faces)
  })
})

describe('straightSkeleton mit zufälligen Grundrissen', () => {
  /** Einfacher reproduzierbarer Zufallsgenerator. */
  function random(seed: number) {
    return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  }

  it('deckt rechtwinklige Grundrisse aus mehreren Rechtecken genau ab', async () => {
    const { default: polygonClipping } = await import('polygon-clipping')
    const next = random(7)
    let checked = 0
    for (let n = 0; n < 300; n++) {
      const boxes = Array.from({ length: 2 + Math.floor(next() * 3) }, () => {
        const x = Math.round(next() * 10) * 100
        const y = Math.round(next() * 10) * 100
        const w = 300 + Math.round(next() * 8) * 100
        const h = 300 + Math.round(next() * 8) * 100
        return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] as [number, number][][]
      })
      const union = polygonClipping.union(boxes[0], ...boxes.slice(1))
      if (union.length !== 1) continue
      const rings = union[0].map((r) => r.slice(0, -1) as Point[])
      const slopes = rings.map((r) => r.map((): SkeletonStep[] => [{ z: 0, d: 0, slope: next() < 0.15 ? GABLE : deg(30 + Math.round(next() * 3) * 5) }]))
      const result = straightSkeleton(rings, slopes, 0)
      const area = rings.reduce((s, r, i) => s + (i === 0 ? Math.abs(planArea(r)) : -Math.abs(planArea(r))), 0)
      expect(coveredArea(result), `Grundriss ${n}`).toBeCloseTo(area, -1)
      expectPlanar(result.faces)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('Satteldächer mit Giebeln an kurzen Enden auf zufälligen L-Formen', () => {
    const next = random(11)
    for (let n = 0; n < 200; n++) {
      const a = 600 + Math.round(next() * 10) * 100
      const b = 600 + Math.round(next() * 10) * 100
      const w = Math.min(300 + Math.round(next() * 4) * 100, Math.min(a, b) - 200)
      const ring: Point[] = [
        [0, 0],
        [a, 0],
        [a, w],
        [w, w],
        [w, b],
        [0, b],
      ]
      const gables = new Set([1, 4])
      const steps = [ring.map((_, i): SkeletonStep[] => [{ z: 0, d: 0, slope: gables.has(i) ? GABLE : deg(40) }])]
      const result = straightSkeleton([ring], steps, 0)
      expect(coveredArea(result), `L ${a}×${b}×${w}`).toBeCloseTo(a * w + w * (b - w), -1)
      expect(maxZ(result.faces)).toBeCloseTo((w / 2) * Math.tan(deg(40)), 3)
    }
  })
})

describe('straightSkeleton auf konvexen Vielecken', () => {
  it('Dachhöhe ist überall die tiefste Kantenebene', () => {
    let seed = 3
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let n = 0; n < 200; n++) {
      // Konvexes Vieleck aus sortierten Winkeln auf einer Ellipse
      const count = 3 + Math.floor(next() * 7)
      const angles = Array.from({ length: count }, () => next() * 2 * Math.PI).sort((a, b) => a - b)
      const rx = 300 + next() * 400
      const ry = 300 + next() * 400
      const ring: Point[] = angles.map((a) => [Math.cos(a) * rx, Math.sin(a) * ry])
      if (Math.abs(planArea(ring)) < 1e4) continue
      const steps = [ring.map((): SkeletonStep[] => [{ z: 0, d: 0, slope: deg(20 + next() * 50) }])]
      const result = straightSkeleton([ring], steps, 0)
      expect(coveredArea(result), `Vieleck ${n}`).toBeCloseTo(Math.abs(planArea(ring)), -1)
      for (const face of sloped(result.faces)) {
        for (const [x, y, z] of face.polygon) {
          const lowest = Math.min(...sloped(result.faces).map(({ plane: { a, b, c, d } }) => (d - a * x - b * y) / c))
          expect(z, `Vieleck ${n}`).toBeCloseTo(lowest, 3)
        }
      }
    }
  })
})
