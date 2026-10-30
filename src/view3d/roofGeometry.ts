import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import type { Point } from '../model/geometry'
import type { Roof } from '../model/home'
import { planeZ, type RoofModel, type RoofSurface } from '../model/roofs'

/** Materialgruppen eines Dachs: Deckung, Untersicht, Stirnseiten (Traufe, Ortgang, Öffnungen, Attika). */
export const ROOF_TOP = 0
export const ROOF_BOTTOM = 1
export const ROOF_SIDES = 2
/** Farben je Gruppe ohne eigene Oberfläche. */
export const ROOF_COLORS = ['#9c4a33', '#e6dccd', '#f3efe8']

/** Oberflächen eines Dachs in der Reihenfolge der Gruppen. */
export const roofSurfaces = (roof: Roof) => [roof.top, roof.underside, roof.sides]

class Builder {
  positions: number[][] = [[], [], []]
  uvs: number[][] = [[], [], []]

  /** Dreieck in Szenenkoordinaten (x, Höhe, Plan-y) mit UV in cm. */
  triangle(group: number, points: [number, number, number][], uv: [number, number][]) {
    for (let i = 0; i < 3; i++) {
      const [x, y, z] = points[i]
      this.positions[group].push(x, z, y)
      this.uvs[group].push(uv[i][0], uv[i][1])
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry()
    const positions = this.positions.flat()
    const uvs = this.uvs.flat()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    let start = 0
    this.positions.forEach((group, index) => {
      const count = group.length / 3
      if (count > 0) geometry.addGroup(start, count, index)
      start += count
    })
    geometry.computeVertexNormals()
    return geometry
  }
}

const planArea = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/** UV in cm: entlang der Traufe und in wahrer Länge die Fläche hinauf (bzw. wie im Plan bei flachen Flächen). */
function surfaceUv(surface: RoofSurface, p: Point): [number, number] {
  if (surface.slope < 1e-3) return [p[0], p[1]]
  const u = p[0] * surface.dir[0] + p[1] * surface.dir[1]
  const v = (p[0] * surface.up[0] + p[1] * surface.up[1]) / Math.cos(surface.slope)
  return [u, v]
}

/** Waagrechte bzw. geneigte Fläche aus Umriss und Löchern; oben zeigt die Vorderseite nach oben. */
function addFace(builder: Builder, group: number, rings: Point[][], z: (p: Point) => number, uv: (p: Point) => [number, number], up: boolean) {
  const contour = rings[0].map(([x, y]) => new Vector2(x, y))
  const holes = rings.slice(1).map((ring) => ring.map(([x, y]) => new Vector2(x, y)))
  const all = [...rings[0], ...rings.slice(1).flat()]
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, holes)) {
    let triangle = [all[i], all[j], all[k]]
    // In Szenenkoordinaten zeigt die Normale nach oben, wenn das Dreieck im Plan negativ umläuft
    if (planArea(triangle[0], triangle[1], triangle[2]) > 0 === up) triangle = [triangle[0], triangle[2], triangle[1]]
    builder.triangle(
      group,
      triangle.map((p) => [p[0], p[1], z(p)]),
      triangle.map(uv),
    )
  }
}

/** Senkrechtes Band unter einer Kante von {@code top} bis {@code bottom}. */
function addSide(builder: Builder, a: Point, b: Point, top: (p: Point) => number, bottom: (p: Point) => number) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (length < 1e-6) return
  const at = top(a)
  const bt = top(b)
  const ab = bottom(a)
  const bb = bottom(b)
  if (at - ab < 1e-6 && bt - bb < 1e-6) return
  const A: [number, number, number] = [a[0], a[1], at]
  const B: [number, number, number] = [b[0], b[1], bt]
  const C: [number, number, number] = [b[0], b[1], bb]
  const D: [number, number, number] = [a[0], a[1], ab]
  builder.triangle(ROOF_SIDES, [A, D, C], [[0, at], [0, ab], [length, bb]])
  builder.triangle(ROOF_SIDES, [A, C, B], [[0, at], [length, bb], [length, bt]])
}

/**
 * Geometrie eines Dachs in Szenenkoordinaten (cm, Höhe relativ zum Boden der Ebene): je Fläche Ober-
 * und Unterseite (um Dicke / cos(Neigung) tiefer) und senkrechte Stirnseiten an allen Kanten. An
 * Firsten und Kehlen liegen die Stirnseiten im Dach und bleiben unsichtbar; wo Nachbarflächen
 * verschieden geneigt sind, schließen sie die Fuge zwischen den Unterseiten.
 */
export function roofGeometry(model: RoofModel): BufferGeometry {
  const builder = new Builder()
  for (const surface of model.surfaces) {
    const top = (p: Point) => planeZ(surface.plane, p)
    const bottom = (p: Point) => top(p) - surface.offset
    const uv = (p: Point) => surfaceUv(surface, p)
    addFace(builder, ROOF_TOP, surface.rings, top, uv, true)
    addFace(builder, ROOF_BOTTOM, surface.rings, bottom, uv, false)
    for (const ring of surface.rings) ring.forEach((a, i) => addSide(builder, a, ring[(i + 1) % ring.length], top, bottom))
  }
  if (model.parapet && model.surfaces[0]) {
    const base = planeZ(model.surfaces[0].plane, [0, 0])
    const { rings, top } = model.parapet
    const z = () => top
    for (const polygon of [rings]) {
      if (polygon.length === 0) continue
      addFace(builder, ROOF_SIDES, polygon, z, (p) => [p[0], p[1]], true)
      for (const ring of polygon) ring.forEach((a, i) => addSide(builder, a, ring[(i + 1) % ring.length], z, () => base))
    }
  }
  return builder.build()
}
