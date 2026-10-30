/**
 * Dächer: aus Traufpolygon und Kantenprofilen werden über das Straight Skeleton (roofSkeleton.ts)
 * die Dachflächen mit Überstand, Dicke und Öffnungen. Alle Höhen relativ zum Boden der Ebene des Dachs.
 */
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import { pieceCorners, pitchedSize, pointInPolygon, polygonArea, wallPolygon, type Point } from './geometry'
import {
  DEFAULT_ROOF_OVERHANG,
  DEFAULT_ROOF_SLOPE,
  DEFAULT_ROOF_THICKNESS,
  newId,
  type Home,
  type HomePiece,
  type Roof,
  type RoofEdge,
  type RoofProfileStep,
  type RoofShape,
  type Wall,
} from './home'
import { defaultWallHeight, levelElevation } from './levels'
import { straightSkeleton, type Plane, type Point3, type SkeletonStep } from './roofSkeleton'

export const GABLE = Math.PI / 2
/** Unter dieser Neigung gilt eine Kante als flach. */
const MIN_SLOPE = (0.5 * Math.PI) / 180

/** Eine ebene Dachfläche (Oberseite); die Unterseite liegt {@code offset} tiefer. */
export interface RoofSurface {
  /** Umriss und Löcher im Plan. */
  rings: Point[][]
  plane: Plane
  slope: number
  /** Richtung der Traufe und Richtung die Fläche hinauf (im Plan, Einheitsvektoren). */
  dir: Point
  up: Point
  /** Kante des Traufpolygons, zu der die Fläche gehört; {@code null} bei flachen Flächen. */
  edge: number | null
  /** Senkrechter Abstand der Unterseite: Dicke / cos(Neigung). */
  offset: number
}

export interface RoofModel {
  surfaces: RoofSurface[]
  /** Umriss mit Überstand (äußerer Ring, dann Innenhöfe). */
  outline: Point[][]
  /** Wandlinie (Traufpolygon ohne Überstand), Umlaufsinn wie {@code outline}. */
  wallLine: Point[][]
  /** Je Kante von {@code outline[0]} bzw. {@code wallLine[0]} der Index in {@code Roof.edges}. */
  edgeIndex: number[]
  /** First, Grate, Kehlen und Knicke als Linien im Plan (mit Höhe). */
  lines: [Point3, Point3][]
  /** Höhe, in der die Unterseite die Wandlinie trifft. */
  eave: number
  ridge: number
  flat: boolean
  /** Attika eines Flachdachs: Umriss und Höhe ihrer Oberkante. */
  parapet: { rings: Point[][]; top: number } | null
}

/** Höhe einer Ebene im Punkt (Ebene nicht senkrecht). */
export const planeZ = ({ a, b, c, d }: Plane, [x, y]: Point) => (d - a * x - b * y) / c

function signedArea(ring: Point[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return sum / 2
}

const closed = (ring: Point[]): Ring => [...ring, ring[0]]
const open = (ring: Ring): Point[] => ring.slice(0, -1) as Point[]

/**
 * Entfernt doppelte Punkte und Punkte auf einer Geraden; liefert je verbliebener Kante den Index der
 * ursprünglichen Kante (bei zusammengelegten Kanten die erste).
 */
export function cleanRing(points: Point[], tolerance = 0.5): { points: Point[]; source: number[] } {
  const ring = points.map((p, i) => ({ p, i }))
  const at = (k: number) => ring[(k + ring.length) % ring.length].p
  for (let changed = true; changed && ring.length > 3; ) {
    changed = false
    // Doppelte Punkte: der erste fällt weg, die Kante dahinter bleibt
    for (let k = 0; k < ring.length && !changed; k++) {
      const a = at(k)
      const b = at(k + 1)
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < tolerance) {
        ring.splice(k, 1)
        changed = true
      }
    }
    // Punkte auf der Geraden zwischen ihren Nachbarn (auch Spitzen): die Kante davor übernimmt
    for (let k = 0; k < ring.length && !changed && ring.length > 3; k++) {
      const a = at(k - 1)
      const b = at(k)
      const c = at(k + 1)
      const ac = Math.hypot(c[0] - a[0], c[1] - a[1])
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (ac < tolerance || Math.abs(cross) / ac < tolerance * 0.2) {
        ring.splice(k, 1)
        changed = true
      }
    }
  }
  return { points: ring.map((r) => r.p), source: ring.map((r) => r.i) }
}

/** Profil einer Kante mit den Standardwerten des Dachs. */
export function edgeProfile(roof: Pick<Roof, 'slope'>, edge: RoofEdge | undefined): RoofProfileStep[] {
  const profile = edge?.profile && edge.profile.length > 0 ? edge.profile : [{ height: null, slope: roof.slope }]
  // Höhen müssen steigen; was nicht passt, fällt weg, der letzte Abschnitt reicht bis oben
  const result: RoofProfileStep[] = []
  let last = 0
  for (const step of profile) {
    const slope = Math.min(GABLE, Math.max(0, step.slope))
    if (step.height === null || step.height <= last + 0.5) {
      if (step.height === null) {
        result.push({ height: null, slope })
        break
      }
      continue
    }
    result.push({ height: step.height, slope })
    last = step.height
  }
  if (result.length === 0 || result[result.length - 1].height !== null) result.push({ height: null, slope: result.at(-1)?.slope ?? roof.slope })
  return result
}

const isVertical = (slope: number) => slope > GABLE - 1e-6

/**
 * Abschnitte einer Kante für das Skelett. Bezug ist die Unterseite: Sie trifft die Wandlinie
 * ({@code d = 0}) in der Traufhöhe und folgt dem Profil; die Oberseite liegt je Abschnitt um
 * Dicke / cos(Neigung) höher. Ein senkrechter erster Abschnitt (Giebel) steht am Überstand (Ortgang).
 */
function skeletonSteps(profile: RoofProfileStep[], eave: number, overhang: number, thickness: number): { steps: SkeletonStep[]; eaveTop: number } {
  const lift = (slope: number) => (isVertical(slope) ? 0 : thickness / Math.cos(slope))
  // Punkte der Unterseite im Querschnitt (d nach innen, z)
  let d = isVertical(profile[0].slope) ? -overhang : 0
  let z = eave
  const under: { d: number; z: number; slope: number }[] = []
  for (const step of profile) {
    const slope = Math.max(step.slope, MIN_SLOPE)
    under.push({ d, z, slope })
    if (step.height === null) break
    const dz = eave + step.height - z
    if (!isVertical(slope)) d += dz / Math.tan(slope)
    z = eave + step.height
  }
  // Oberseite: Geraden je Abschnitt, Knicke dort, wo sich benachbarte Geraden schneiden
  const steps: SkeletonStep[] = []
  under.forEach((u, k) => {
    const line = { d: u.d, z: u.z + lift(u.slope), slope: u.slope }
    if (k === 0) {
      steps.push(line)
      return
    }
    const prev = steps[k - 1]
    let point = { d: line.d, z: line.z }
    if (!isVertical(prev.slope) || !isVertical(line.slope)) {
      // prev: z = prev.z + tan(prev)·(d − prev.d), bzw. d = prev.d bei senkrechter Geraden
      if (isVertical(prev.slope)) point = { d: prev.d, z: line.z + Math.tan(line.slope) * (prev.d - line.d) }
      else if (isVertical(line.slope)) point = { d: line.d, z: prev.z + Math.tan(prev.slope) * (line.d - prev.d) }
      else {
        const tp = Math.tan(prev.slope)
        const tl = Math.tan(line.slope)
        if (Math.abs(tp - tl) > 1e-9) {
          const dd = (line.z - prev.z + tp * prev.d - tl * line.d) / (tp - tl)
          point = { d: dd, z: prev.z + tp * (dd - prev.d) }
        }
      }
    }
    steps.push({ d: point.d, z: Math.max(point.z, prev.z + 1e-3), slope: line.slope })
  })
  const first = steps[0]
  const eaveTop = isVertical(first.slope) ? eave : first.z - (overhang + first.d) * Math.tan(first.slope)
  return { steps, eaveTop }
}

/** Ring mit je Kante um {@code distance[i]} nach außen versetzten Kanten (Umlaufsinn: Dach links). */
export function offsetRing(ring: Point[], distance: number[]): Point[] {
  const n = ring.length
  const lines = ring.map((a, i) => {
    const b = ring[(i + 1) % n]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const dir: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    // Außen ist rechts der Richtung
    const out: Point = [dir[1], -dir[0]]
    return { p: [a[0] + out[0] * distance[i], a[1] + out[1] * distance[i]] as Point, dir }
  })
  return ring.map((_, i) => {
    const l1 = lines[(i + n - 1) % n]
    const l2 = lines[i]
    const det = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0]
    if (Math.abs(det) < 1e-9) return l2.p
    const t = ((l2.p[0] - l1.p[0]) * l2.dir[1] - (l2.p[1] - l1.p[1]) * l2.dir[0]) / det
    return [l1.p[0] + l1.dir[0] * t, l1.p[1] + l1.dir[1] * t]
  })
}

/** Ringe so drehen, dass das Dach links jeder Kante liegt; mit Zuordnung zu den Kanten der Eingabe. */
function orient(ring: Point[], outer: boolean): { ring: Point[]; edgeOf: (i: number) => number } {
  const n = ring.length
  const reversed = outer ? signedArea(ring) < 0 : signedArea(ring) > 0
  if (!reversed) return { ring, edgeOf: (i) => i }
  return { ring: [...ring].reverse(), edgeOf: (i) => (2 * n - 2 - i) % n }
}

export interface RoofContext {
  /** Höhe, in der die Unterseite die Wandlinie trifft, falls das Dach keine eigene hat. */
  wallHeight: number
  /** Öffnungen im Grundriss (Treppen, Dachfenster). */
  holes?: Polygon[]
  /** Bereiche, in denen das Dach unter einer Gaube liegt: je Dachfläche ausgeschnitten, wo sie tiefer liegt. */
  cutBelow?: { region: Polygon; surfaces: RoofSurface[] }[]
  /** Bereiche, in denen die Flächen unter einem anderen Dach liegen und wegfallen (Gauben am Hauptdach). */
  clipUnder?: RoofSurface[]
}

/** Normiertes Dach: Eingabe mit Kanten, die zum Grundriss passen. */
function roofInput(roof: Roof) {
  const cleaned = cleanRing(roof.points)
  const outer = orient(cleaned.points, true)
  const rings = [outer.ring]
  const edgeSettings: (RoofEdge | undefined)[][] = [outer.ring.map((_, i) => roof.edges[cleaned.source[outer.edgeOf(i)]])]
  const edgeIndex: number[][] = [outer.ring.map((_, i) => cleaned.source[outer.edgeOf(i)])]
  for (const hole of roof.holes ?? []) {
    const h = cleanRing(hole)
    if (h.points.length < 3) continue
    const o = orient(h.points, false)
    rings.push(o.ring)
    edgeSettings.push(o.ring.map(() => undefined))
    edgeIndex.push(o.ring.map(() => -1))
  }
  return { rings, edgeSettings, edgeIndex }
}

/** Ob alle Kanten flach sind: dann wird das Dach eine Platte. */
export function isFlatRoof(roof: Roof): boolean {
  return roof.shape === 'flat' || roof.points.every((_, i) => edgeProfile(roof, roof.edges[i]).every((s) => s.slope < MIN_SLOPE))
}

function lift(rings: Point[][], plane: Plane): Point3[][] {
  return rings.map((ring) => ring.map((p) => [p[0], p[1], planeZ(plane, p)]))
}

function toRings(multi: MultiPolygon): Point[][][] {
  return multi.map((polygon) => polygon.map(open)).filter((polygon) => polygon[0]?.length >= 3)
}

/** Halbebene a·x + b·y < c als großes Polygon um {@code bounds}. */
export function halfPlane(a: number, b: number, c: number, bounds: Point[]): Polygon | null {
  const length = Math.hypot(a, b)
  if (length < 1e-12) return c > 0 ? [closed(bounds)] : null
  const n: Point = [a / length, b / length]
  const limit = c / length
  // Punkt auf der Grenze, Richtung entlang der Grenze, ausreichend groß
  const xs = bounds.map((p) => p[0])
  const ys = bounds.map((p) => p[1])
  const size = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) + 1e4
  const center: Point = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2]
  const along = center[0] * n[0] + center[1] * n[1] - limit
  const base: Point = [center[0] - n[0] * along, center[1] - n[1] * along]
  const t: Point = [-n[1], n[0]]
  const ring: Point[] = [
    [base[0] + t[0] * size, base[1] + t[1] * size],
    [base[0] + t[0] * size - n[0] * size, base[1] + t[1] * size - n[1] * size],
    [base[0] - t[0] * size - n[0] * size, base[1] - t[1] * size - n[1] * size],
    [base[0] - t[0] * size, base[1] - t[1] * size],
  ]
  return [closed(ring)]
}

/** Bereich der Fläche {@code s}, in dem sie unter der Ebene {@code other} liegt. */
function regionBelow(s: RoofSurface, other: Plane): Polygon | null {
  // planeZ(s) < planeZ(other) ⇔ (d1 − a1x − b1y)/c1 < (d2 − a2x − b2y)/c2
  const p = s.plane
  const a = -p.a / p.c + other.a / other.c
  const b = -p.b / p.c + other.b / other.c
  const c = other.d / other.c - p.d / p.c
  return halfPlane(a, b, c, s.rings[0])
}

/** Berechnet die Flächen eines Dachs. */
export function computeRoof(roof: Roof, context: RoofContext): RoofModel {
  const eave = roof.baseHeight ?? context.wallHeight
  const thickness = Math.max(1, roof.thickness)
  const { rings, edgeSettings, edgeIndex } = roofInput(roof)
  const empty: RoofModel = { surfaces: [], outline: [], wallLine: rings, edgeIndex: edgeIndex[0], lines: [], eave, ridge: eave, flat: false, parapet: null }
  if (rings[0].length < 3 || polygonArea(rings[0]) < 1) return empty

  const overhangs = edgeSettings.map((ring) => ring.map((e) => Math.max(0, e?.overhang ?? roof.overhang)))
  const outline = rings.map((ring, r) => offsetRing(ring, overhangs[r]))
  const outlinePolygon: Polygon = outline.map(closed)
  const flat = isFlatRoof(roof)

  const surfaces: RoofSurface[] = []
  let ridge = eave + thickness
  let lines: [Point3, Point3][] = []

  if (flat) {
    const top = eave + thickness
    surfaces.push({ rings: outline, plane: { a: 0, b: 0, c: -1, d: -top }, slope: 0, dir: [1, 0], up: [0, 1], edge: null, offset: thickness })
  } else {
    const steps: SkeletonStep[][][] = []
    let zStart = Infinity
    rings.forEach((ring, r) => {
      steps.push(
        ring.map((_, i) => {
          const profile = edgeProfile(roof, edgeSettings[r][i])
          const result = skeletonSteps(profile, eave, overhangs[r][i], thickness)
          if (!isVertical(result.steps[0].slope)) zStart = Math.min(zStart, result.eaveTop)
          return result.steps
        }),
      )
    })
    if (!Number.isFinite(zStart)) zStart = eave
    const maxHeight = roof.maxHeight !== null && roof.maxHeight > 0 ? eave + thickness + roof.maxHeight : null
    const skeleton = straightSkeleton(rings, steps, zStart, maxHeight)
    for (const face of skeleton.faces) {
      if (Math.abs(face.plane.c) < 1e-6) continue
      const ring = rings[face.ring]
      const a = ring[face.edge]
      const b = ring[(face.edge + 1) % ring.length]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const dir: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
      const plan = face.polygon.map((p): Point => [p[0], p[1]])
      if (Math.abs(signedArea(plan)) < 0.01) continue
      let clipped: MultiPolygon
      try {
        clipped = polygonClipping.intersection([closed(plan)], outlinePolygon)
      } catch {
        continue
      }
      const slope = steps[face.ring][face.edge][face.step].slope
      for (const polygon of toRings(clipped)) {
        surfaces.push({
          rings: polygon,
          plane: face.plane,
          slope,
          dir,
          up: [-dir[1], dir[0]],
          edge: face.ring === 0 ? edgeIndex[face.ring][face.edge] : null,
          offset: thickness / Math.cos(slope),
        })
      }
    }
    if (skeleton.top.length > 0) {
      const positive = skeleton.top.filter((r) => signedArea(r) > 0).map((r) => [closed(r)] as Polygon)
      const negative = skeleton.top.filter((r) => signedArea(r) < 0).map((r) => [closed(r)] as Polygon)
      try {
        let top: MultiPolygon = positive.length > 0 ? polygonClipping.union(positive[0], ...positive.slice(1)) : []
        if (negative.length > 0 && top.length > 0) top = polygonClipping.difference(top, ...negative)
        top = polygonClipping.intersection(top, outlinePolygon)
        for (const polygon of toRings(top)) {
          surfaces.push({ rings: polygon, plane: { a: 0, b: 0, c: -1, d: -skeleton.zEnd }, slope: 0, dir: [1, 0], up: [0, 1], edge: null, offset: thickness })
        }
      } catch {
        // Ohne flachen Abschluss weiter
      }
    }
  }

  // Öffnungen und Gauben ausschneiden
  const cuts: Polygon[] = [...(context.holes ?? [])]
  const result: RoofSurface[] = []
  for (const surface of surfaces) {
    let shape: MultiPolygon = [surface.rings.map(closed)]
    try {
      const own: Polygon[] = [...cuts]
      for (const { region, surfaces: above } of context.cutBelow ?? []) {
        for (const other of above) {
          const below = regionBelow(surface, other.plane)
          if (!below) continue
          const part = polygonClipping.intersection(region, below, other.rings.map(closed))
          for (const polygon of part) own.push(polygon)
        }
      }
      for (const other of context.clipUnder ?? []) {
        const below = regionBelow(surface, other.plane)
        if (!below) continue
        for (const polygon of polygonClipping.intersection(below, other.rings.map(closed))) own.push(polygon)
      }
      if (own.length > 0) shape = polygonClipping.difference(shape, ...own)
    } catch {
      // Bei ungültigen Öffnungen die Fläche ganz lassen
    }
    for (const polygon of toRings(shape)) result.push({ ...surface, rings: polygon })
  }

  for (const surface of result) for (const ring of surface.rings) for (const p of ring) ridge = Math.max(ridge, planeZ(surface.plane, p))
  lines = surfaceLines(result, [...outline, ...cuts.flatMap((p) => p.map(open))])

  let parapet: RoofModel['parapet'] = null
  if (flat && roof.parapet && roof.parapet > 0) {
    const width = 20
    const inner = outline.map((ring) => offsetRing(ring, ring.map(() => -width)))
    try {
      const area = polygonClipping.difference(outlinePolygon, [closed(inner[0])])
      parapet = { rings: toRings(area).flat(), top: eave + thickness + roof.parapet }
    } catch {
      parapet = null
    }
  }
  return { surfaces: result, outline, wallLine: rings, edgeIndex: edgeIndex[0], lines, eave, ridge, flat, parapet }
}

// ——— Dächer eines Projekts ———

const rawCache = new WeakMap<Roof, { wallHeight: number; model: RoofModel }>()

/** Dach ohne Öffnungen und Gauben; zwischengespeichert, solange sich das Dach nicht ändert. */
export function rawRoofModel(home: Pick<Home, 'levels' | 'wallHeight'>, roof: Roof): RoofModel {
  const wallHeight = defaultWallHeight(home as Home, roof.level)
  const cached = rawCache.get(roof)
  if (cached && cached.wallHeight === wallHeight) return cached.model
  const model = computeRoof(roof, { wallHeight })
  rawCache.set(roof, { wallHeight, model })
  return model
}

/**
 * Alle Dächer mit Gauben: Gauben fallen weg, wo sie unter ihrem Hauptdach liegen, das Hauptdach ist
 * innerhalb der Gaube offen, wo es unter ihr liegt. {@code holes}: weitere Öffnungen je Dach (Treppen,
 * Dachfenster) im Plan.
 */
export function roofModels(home: Pick<Home, 'levels' | 'wallHeight' | 'roofs'>, holes?: (roof: Roof) => Polygon[]): Map<string, RoofModel> {
  const byId = new Map(home.roofs.map((r) => [r.id, r]))
  const result = new Map<string, RoofModel>()
  for (const roof of home.roofs) {
    const raw = rawRoofModel(home, roof)
    const extraHoles = holes?.(roof) ?? []
    const main = roof.dormer ? byId.get(roof.dormer.roofId) : undefined
    const dormers = home.roofs.filter((r) => r.dormer?.roofId === roof.id)
    if (extraHoles.length === 0 && !main && dormers.length === 0) {
      result.set(roof.id, raw)
      continue
    }
    result.set(
      roof.id,
      computeRoof(roof, {
        wallHeight: defaultWallHeight(home as Home, roof.level),
        holes: extraHoles,
        cutBelow: dormers.map((dormer) => ({ region: [closed(dormer.points)], surfaces: rawRoofModel(home, dormer).surfaces })),
        clipUnder: main ? rawRoofModel(home, main).surfaces : undefined,
      }),
    )
  }
  return result
}

/** Kanten zwischen Flächen (First, Grat, Kehle, Knick) ohne die Ränder. */
function surfaceLines(surfaces: RoofSurface[], borders: Point[][]): [Point3, Point3][] {
  const onBorder = (p: Point) =>
    borders.some((ring) =>
      ring.some((a, i) => {
        const b = ring[(i + 1) % ring.length]
        return distanceToSegment(p, a, b) < 0.5
      }),
    )
  const seen = new Set<string>()
  const lines: [Point3, Point3][] = []
  for (const surface of surfaces) {
    for (const ring of lift(surface.rings, surface.plane)) {
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length]
        const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        if (onBorder(mid)) return
        const ka = `${Math.round(a[0])},${Math.round(a[1])}`
        const kb = `${Math.round(b[0])},${Math.round(b[1])}`
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
        if (ka === kb || seen.has(key)) return
        seen.add(key)
        lines.push([a, b])
      })
    }
  }
  return lines
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function insideSurface(surface: RoofSurface, p: Point): boolean {
  return pointInPolygon(p, surface.rings[0]) && !surface.rings.slice(1).some((hole) => pointInPolygon(p, hole))
}

/** Höhe der Oberseite (bzw. Unterseite) im Punkt oder {@code null} außerhalb des Dachs. */
export function roofHeightAt(model: RoofModel, p: Point, side: 'top' | 'bottom' = 'top'): number | null {
  let best: number | null = null
  for (const surface of model.surfaces) {
    if (!insideSurface(surface, p)) continue
    const z = planeZ(surface.plane, p) - (side === 'bottom' ? surface.offset : 0)
    if (best === null || z > best) best = z
  }
  return best
}

/** Fläche, die im Punkt oben liegt. */
export function roofSurfaceAt(model: RoofModel, p: Point): RoofSurface | null {
  let best: RoofSurface | null = null
  let bestZ = -Infinity
  for (const surface of model.surfaces) {
    if (!insideSurface(surface, p)) continue
    const z = planeZ(surface.plane, p)
    if (z > bestZ) {
      bestZ = z
      best = surface
    }
  }
  return best
}

/** Abschnitt einer Strecke a→b (Anteile t0..t1) unter einer Dachfläche mit Höhen an beiden Enden. */
export interface HeightPiece {
  t0: number
  t1: number
  z0: number
  z1: number
}

/**
 * Höhenverlauf der Unterseite (bzw. Oberseite) entlang der Strecke a→b: je Dachfläche die Abschnitte,
 * die über der Strecke liegen. Wo sich Flächen überdecken, zählt die tiefere Unterseite.
 */
export function roofHeightsAlong(model: RoofModel, a: Point, b: Point, side: 'top' | 'bottom' = 'bottom'): HeightPiece[] {
  const ts = new Set<number>([0, 1])
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  for (const surface of model.surfaces) {
    for (const ring of surface.rings) {
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]
        const ex = q[0] - p[0]
        const ey = q[1] - p[1]
        const det = dx * ey - dy * ex
        if (Math.abs(det) < 1e-12) return
        const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / det
        const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / det
        if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) ts.add(t)
      })
    }
  }
  const sorted = [...ts].sort((x, y) => x - y)
  const pieces: HeightPiece[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i]
    const t1 = sorted[i + 1]
    if (t1 - t0 < 1e-9) continue
    const mid: Point = [a[0] + dx * (t0 + t1) / 2, a[1] + dy * (t0 + t1) / 2]
    let chosen: RoofSurface | null = null
    let chosenZ = Infinity
    for (const surface of model.surfaces) {
      if (!insideSurface(surface, mid)) continue
      const z = planeZ(surface.plane, mid) - (side === 'bottom' ? surface.offset : 0)
      if (side === 'bottom' ? z < chosenZ : chosen === null || z > chosenZ) {
        chosen = surface
        chosenZ = z
      }
    }
    if (!chosen) continue
    const at = (t: number) => planeZ(chosen!.plane, [a[0] + dx * t, a[1] + dy * t]) - (side === 'bottom' ? chosen!.offset : 0)
    pieces.push({ t0, t1, z0: at(t0), z1: at(t1) })
  }
  return pieces
}

/** Schnittlinien der Oberseite in Höhe z (z. B. 1 m über dem Boden der Ebene darüber: Kniestock). */
export function roofContour(model: RoofModel, z: number): [Point, Point][] {
  const segments: [Point, Point][] = []
  for (const surface of model.surfaces) {
    if (surface.slope < MIN_SLOPE) continue
    for (const ring of surface.rings) {
      // Kanten des Umrisses, die die Höhe z kreuzen, liefern die Endpunkte; für konvexe Teilflächen genau zwei
      const crossings: Point[] = []
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]
        const zp = planeZ(surface.plane, p)
        const zq = planeZ(surface.plane, q)
        if ((zp - z) * (zq - z) < 0) {
          const t = (z - zp) / (zq - zp)
          crossings.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
        }
      })
      // Entlang der Traufrichtung sortieren und paarweise verbinden
      crossings.sort((m, n) => m[0] * surface.dir[0] + m[1] * surface.dir[1] - (n[0] * surface.dir[0] + n[1] * surface.dir[1]))
      for (let i = 0; i + 1 < crossings.length; i += 2) segments.push([crossings[i], crossings[i + 1]])
    }
  }
  return segments
}

/** Grundrissfläche und wahre Fläche der Dachdeckung in cm². */
export function roofAreas(model: RoofModel): { plan: number; true: number } {
  let plan = 0
  let area = 0
  for (const surface of model.surfaces) {
    const a = polygonArea(surface.rings[0]) - surface.rings.slice(1).reduce((s, h) => s + polygonArea(h), 0)
    plan += a
    area += a / Math.cos(surface.slope)
  }
  return { plan, true: area }
}

// ——— Vorlagen ———

/** Dachformen in der Reihenfolge der Auswahl. */
export const ROOF_SHAPES: RoofShape[] = ['gable', 'hip', 'halfHip', 'shed', 'flat', 'mansard', 'mansardHip', 'barrel']

export type EdgeKind = 'eave' | 'gable' | 'halfHip'

/** Art einer Kante nach ihrem Profil. */
export function edgeKind(roof: Roof, edge: RoofEdge | undefined): EdgeKind | 'custom' {
  const profile = edgeProfile(roof, edge)
  if (profile.length === 1) return profile[0].slope >= GABLE - 1e-6 ? 'gable' : 'eave'
  if (profile.length === 2 && profile[0].slope >= GABLE - 1e-6) return 'halfHip'
  return 'custom'
}

/** Profil für eine Kantenart; der Krüppelwalm beginnt bei 60 % der Firsthöhe. */
export function profileFor(roof: Roof, kind: EdgeKind, ridgeHeight: number): RoofProfileStep[] | null {
  if (kind === 'eave') return null
  if (kind === 'gable') return [{ height: null, slope: GABLE }]
  return [
    { height: Math.max(20, Math.round(ridgeHeight * 0.6)), slope: GABLE },
    { height: null, slope: roof.slope },
  ]
}


function edgeLengths(points: Point[]): number[] {
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length]
    return Math.hypot(b[0] - a[0], b[1] - a[1])
  })
}

/**
 * Kanten, die bei einem Satteldach Giebel werden: Enden eines Firsts, also Kanten zwischen zwei
 * konvexen Ecken, deren Fläche beim Walmdach ein Dreieck ist. Ist das bei allen so (Quadrat,
 * Zeltdach), werden bei vier Ecken die Kanten 1 und 3 Giebel.
 */
export function gableEdges(points: Point[]): Set<number> {
  const n = points.length
  const result = new Set<number>()
  if (n < 3) return result
  const ccw = signedArea(points) > 0
  const convex = points.map((b, i) => {
    const a = points[(i + n - 1) % n]
    const c = points[(i + 1) % n]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    return ccw ? cross > 0 : cross < 0
  })
  const skeleton = straightSkeleton([points], [points.map(() => [{ z: 0, d: 0, slope: Math.PI / 4 }])], 0)
  const corners = new Map<number, number>()
  for (const face of skeleton.faces) corners.set(face.edge, Math.max(corners.get(face.edge) ?? 0, face.polygon.length))
  for (let i = 0; i < n; i++) if (convex[i] && convex[(i + 1) % n] && corners.get(i) === 3) result.add(i)
  if (result.size === n && n === 4) {
    const lengths = edgeLengths(points)
    result.clear()
    for (const i of lengths[0] + lengths[2] >= lengths[1] + lengths[3] ? [1, 3] : [0, 2]) result.add(i)
  }
  return result
}

/** Neue Kanten für eine Dachform; {@code ridge}: Firsthöhe des Walmdachs mit gleicher Neigung (für Profile). */
export function shapeEdges(roof: Roof, shape: RoofShape): Pick<Roof, 'edges' | 'shape' | 'slope' | 'maxHeight' | 'parapet'> {
  const points = roof.points
  // Die Neigung des Dachs bleibt, nur ein Flachdach hat keine (und bekommt beim Wechsel wieder eine)
  const slope = roof.slope >= MIN_SLOPE ? roof.slope : DEFAULT_ROOF_SLOPE
  const keep = (e: RoofEdge | undefined): RoofEdge => ({ profile: null, overhang: e?.overhang ?? null })
  const base = { shape, slope, maxHeight: null, parapet: shape === 'flat' ? roof.parapet : null }
  if (shape === 'custom') return { edges: roof.edges, shape, slope: roof.slope, maxHeight: roof.maxHeight, parapet: roof.parapet }
  if (shape === 'flat') return { ...base, slope: 0, edges: points.map((_, i) => keep(roof.edges[i])) }
  // Halbe Breite: Firsthöhe eines 45°-Walmdachs
  const hip45 = computeRoof({ ...roof, shape: 'hip', slope: Math.PI / 4, thickness: 1, overhang: 0, maxHeight: null, edges: points.map(() => ({ profile: null, overhang: 0 })) }, { wallHeight: 0 })
  const halfWidth = Math.max(50, hip45.ridge - 1)
  // Gaube: Kante 0 ist die Front, Kante 2 liegt im Hauptdach und bleibt immer Giebel
  const dormer = !!roof.dormer && points.length === 4
  const gables = dormer ? new Set([0, 2]) : gableEdges(points)
  const lengths = edgeLengths(points)
  const longest = dormer ? 0 : lengths.indexOf(Math.max(...lengths))
  const gable: RoofProfileStep[] = [{ height: null, slope: GABLE }]
  const edge = (i: number, profile: RoofProfileStep[] | null): RoofEdge => ({ profile: dormer && i === 2 ? gable : profile, overhang: roof.edges[i]?.overhang ?? null })
  switch (shape) {
    case 'hip':
      return { ...base, edges: points.map((_, i) => edge(i, null)) }
    case 'gable':
      return { ...base, edges: points.map((_, i) => edge(i, gables.has(i) ? gable : null)) }
    case 'shed':
      return { ...base, edges: points.map((_, i) => edge(i, i === longest ? null : gable)) }
    case 'halfHip': {
      const ridge = halfWidth * Math.tan(slope)
      const profile: RoofProfileStep[] = [{ height: Math.round(ridge * 0.6), slope: GABLE }, { height: null, slope }]
      return { ...base, edges: points.map((_, i) => edge(i, gables.has(i) ? profile : null)) }
    }
    case 'mansard':
    case 'mansardHip': {
      const steep = (70 * Math.PI) / 180
      const shallow = (30 * Math.PI) / 180
      const height = Math.round(Math.min(260, halfWidth * 0.35 * Math.tan(steep)))
      const profile: RoofProfileStep[] = [{ height, slope: steep }, { height: null, slope: shallow }]
      return { ...base, edges: points.map((_, i) => edge(i, shape === 'mansard' && gables.has(i) ? gable : profile)) }
    }
    case 'barrel': {
      // Kreisbogen vom Traufwinkel 60° bis fast waagrecht über die halbe Breite
      const start = (60 * Math.PI) / 180
      const radius = halfWidth / Math.sin(start)
      const count = 6
      const profile: RoofProfileStep[] = []
      for (let k = 0; k < count; k++) {
        const a0 = start * (1 - k / count)
        const a1 = start * (1 - (k + 1) / count)
        const height = radius * (Math.cos(a1) - Math.cos(start))
        profile.push({ height: k === count - 1 ? null : Math.round(height * 10) / 10, slope: (a0 + a1) / 2 })
      }
      return { ...base, edges: points.map((_, i) => edge(i, gables.has(i) ? gable : profile)) }
    }
  }
}

/** Neues Dach über einem Umriss mit Satteldach. */
export function createRoof(points: Point[], level: string | null, shape: RoofShape = 'gable'): Roof {
  const roof: Roof = {
    id: newId('roof'),
    name: null,
    level,
    points: points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
    holes: [],
    edges: points.map(() => ({ profile: null, overhang: null })),
    baseHeight: null,
    slope: DEFAULT_ROOF_SLOPE,
    overhang: DEFAULT_ROOF_OVERHANG,
    thickness: DEFAULT_ROOF_THICKNESS,
    maxHeight: null,
    parapet: null,
    shape,
    visible: true,
  }
  return { ...roof, ...shapeEdges(roof, shape) }
}

/**
 * Außenumriss der Wände um den Punkt (Doppelklick mit dem Dach-Werkzeug): die Vereinigung aller
 * Wandflächen, in deren Umriss der Punkt liegt; Innenhöfe werden Löcher des Dachs.
 */
export function outlineFromWalls(walls: Wall[], point: Point): { points: Point[]; holes: Point[][] } | null {
  if (walls.length === 0) return null
  const byId = new Map(walls.map((w) => [w.id, w]))
  const polygons: Polygon[] = walls.map((w) => [closed(wallPolygon(w, byId))])
  let union: MultiPolygon
  try {
    union = polygonClipping.union(polygons[0], ...polygons.slice(1))
  } catch {
    return null
  }
  let best: Polygon | null = null
  for (const polygon of union) {
    const outer = open(polygon[0])
    if (pointInPolygon(point, outer) && (!best || polygonArea(outer) < polygonArea(open(best[0])))) best = polygon
  }
  if (!best) return null
  const outer = open(best[0])
  // Löcher, die kein Raum sind, sondern Höfe: Wandflächen außen herum, also groß genug und ohne Wand dahinter
  // lassen sich nicht sicher erkennen, daher bleibt das Dach geschlossen
  return { points: outer, holes: [] }
}

/** Wände, deren Außenseite auf der Wandlinie des Dachs liegt (Giebel- und Traufwände). */
export function wallsUnderRoofEdge(walls: Wall[], roof: Roof): Wall[] {
  const ring = roof.points
  return walls.filter((wall) => {
    const mid: Point = [(wall.xStart + wall.xEnd) / 2, (wall.yStart + wall.yEnd) / 2]
    return ring.some((a, i) => distanceToSegment(mid, a, ring[(i + 1) % ring.length]) < wall.thickness * 0.75)
  })
}

/** Höhen des Dachs im Bezug der Ebene. */
export function roofContext(home: Home, roof: Roof): RoofContext {
  return { wallHeight: defaultWallHeight(home, roof.level) }
}

/** Absolute Höhe des Bodens der Ebene eines Dachs. */
export const roofElevation = (home: Home, roof: Roof) => levelElevation(home, roof.level)

/** Lineare Höhe z = gx·x + gy·y + g0. */
export type LinearHeight = [number, number, number]

/** Teil des Grundrisses einer Wand mit der Höhe ihrer Ober- und ggf. Unterkante (über dem Boden der Ebene der Wand). */
export interface WallCap {
  area: MultiPolygon
  height: LinearHeight
  /** Unterkante, wenn die Wand auf einem Dach steht (Gaube); sonst unten wie jede Wand. */
  bottom?: LinearHeight
}

export const linearZ = ([gx, gy, g0]: LinearHeight, [x, y]: Point) => gx * x + gy * y + g0

/**
 * Oberkante einer Wand, die bis zum Dach reicht: Der Grundriss {@code outline} wird nach den
 * Dachflächen darüber aufgeteilt, dort folgt die Wand der Unterseite (auch von Dächern anderer
 * Ebenen, über die absolute Höhe). Liegen Flächen übereinander, gilt die des niedrigeren Dachs. Wo
 * kein Dach ist, bleibt die Wand {@code height} hoch.
 */
export function wallCaps(
  home: Pick<Home, 'levels' | 'roofs'>,
  models: Map<string, RoofModel>,
  level: string | null,
  outline: Point[],
  height: number,
  standOn?: { model: RoofModel; level: string | null },
): WallCap[] {
  const base = levelElevation(home as Home, level)
  const wall: Polygon = [closed(outline)]
  const caps: WallCap[] = []
  let assigned: MultiPolygon = []
  const roofs = home.roofs
    .map((roof) => ({ model: models.get(roof.id), shift: levelElevation(home as Home, roof.level) - base }))
    .filter((r): r is { model: RoofModel; shift: number } => !!r.model && r.model.ridge + r.shift > 0)
    .sort((a, b) => a.model.eave + a.shift - (b.model.eave + b.shift))
  for (const { model, shift } of roofs) {
    for (const surface of model.surfaces) {
      let area = polygonClipping.intersection(wall, surface.rings.map(closed) as Polygon)
      if (area.length === 0) continue
      if (assigned.length > 0) area = polygonClipping.difference(area, assigned)
      if (area.length === 0) continue
      assigned = polygonClipping.union(assigned, area)
      caps.push({ area, height: underside(surface, shift) })
    }
  }
  const rest = assigned.length > 0 ? polygonClipping.difference(wall, assigned) : [wall]
  if (rest.length > 0) caps.push({ area: rest, height: [0, 0, height] })
  if (!standOn) return caps
  // Wände einer Gaube stehen auf der Unterseite des Hauptdachs
  const shift = levelElevation(home as Home, standOn.level) - base
  return caps.flatMap((cap) => {
    const parts: WallCap[] = []
    let rest = cap.area
    for (const surface of standOn.model.surfaces) {
      if (rest.length === 0) break
      const ring = surface.rings.map(closed) as Polygon
      const area = polygonClipping.intersection(rest, ring)
      if (area.length === 0) continue
      parts.push({ ...cap, area, bottom: underside(surface, shift) })
      rest = polygonClipping.difference(rest, ring)
    }
    if (rest.length > 0) parts.push({ ...cap, area: rest })
    return parts
  })
}

/** Unterseite einer Dachfläche als lineare Höhe, um {@code shift} angehoben. */
function underside({ plane: { a, b, c, d }, offset }: RoofSurface, shift: number): LinearHeight {
  return [-a / c, -b / c, d / c - offset + shift]
}

export { DEFAULT_ROOF_OVERHANG, DEFAULT_ROOF_THICKNESS }

/**
 * Lage eines Dachfensters auf der Dachfläche im Punkt (x, y): Die Neigung (pitch = 90° − Dachneigung)
 * legt das Fenster in die Fläche, seine Vorderseite (lokal +y) zeigt nach außen, die Oberkante zum
 * First. Die Mitte des Fensters liegt in der Mitte der Dachdicke; {@code elevation} ist wie in Sweet
 * Home 3D die Unterkante des geneigten Fensters. {@code null}, wenn dort kein Dach der Ebene ist.
 */
export function skylightPlacement(
  home: Pick<Home, 'levels' | 'wallHeight' | 'roofs'>,
  piece: Pick<HomePiece, 'x' | 'y' | 'depth' | 'height' | 'angle' | 'level'>,
  model: (roof: Roof) => RoofModel = (roof) => rawRoofModel(home, roof),
): Pick<HomePiece, 'angle' | 'pitch' | 'elevation' | 'roofId'> | null {
  const p: Point = [piece.x, piece.y]
  let best: { roof: Roof; surface: RoofSurface; z: number } | null = null
  for (const roof of home.roofs) {
    if ((roof.level ?? null) !== (piece.level ?? null)) continue
    const surface = roofSurfaceAt(model(roof), p)
    const z = surface ? planeZ(surface.plane, p) : -Infinity
    if (surface && (!best || z > best.z)) best = { roof, surface, z }
  }
  if (!best) return null
  const { surface, z } = best
  const flat = surface.slope < MIN_SLOPE
  const pitch = Math.PI / 2 - (flat ? 0 : surface.slope)
  // Lokal −y zeigt die Fläche hinauf: (sin a, −cos a) = up
  const angle = flat ? piece.angle : Math.atan2(surface.up[0], -surface.up[1])
  const center = z - surface.offset / 2
  const { height } = pitchedSize({ ...piece, pitch })
  return {
    angle: ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
    pitch,
    elevation: Math.round((center - height / 2) * 10) / 10,
    roofId: best.roof.id,
  }
}

/** Öffnung eines Dachfensters im Plan: Breite × Höhe des Fensters in der Fläche, ohne Rahmentiefe. */
export function skylightHole(piece: HomePiece): Point[] {
  return pieceCorners({ ...piece, depth: piece.height * Math.abs(Math.sin(piece.pitch ?? 0)), pitch: 0 })
}

/** Dachfenster an geänderte Dächer anpassen (Neigung, Richtung, Höhe). */
export function refitSkylights(home: Home, roofIds: Set<string>) {
  // Neu berechnet: Die geänderten Dächer können dieselben Objekte sein wie vorher (Zwischenspeicher)
  const models = new Map<Roof, RoofModel>()
  const model = (roof: Roof) => models.get(roof) ?? models.set(roof, computeRoof(roof, roofContext(home, roof))).get(roof)!
  for (const piece of home.furniture) {
    if (!piece.roofId || !roofIds.has(piece.roofId)) continue
    const placement = skylightPlacement(home, piece, model)
    if (placement) Object.assign(piece, placement)
  }
}

/** Mindesthöhe der Gaubenfront über der Unterseite des Hauptdachs (bis zur Traufe der Gaube). */
const DORMER_MIN_FRONT = 80
const DORMER_WALL_THICKNESS = 12

/**
 * Gaube auf der Fläche des Dachs {@code main}, die im Plan unter {@code a} liegt: Breite und Front aus dem
 * Rechteck von {@code a} nach {@code b}, ausgerichtet an der Fläche (Front unten, parallel zur Traufe).
 * Hinten am Rechteck trifft ihr Dach auf das Hauptdach, daraus folgt die Höhe der Front (mindestens
 * DORMER_MIN_FRONT, dann reicht die Gaube weiter nach hinten, aber nicht über den First). Dazu drei Wände
 * bis zum Dach, die auf dem Hauptdach stehen. {@code null}, wenn dort keine geneigte Fläche ist oder das
 * Rechteck zu schmal ist.
 */
export function createDormer(
  home: Pick<Home, 'levels' | 'wallHeight' | 'roofs'>,
  main: Roof,
  a: Point,
  b: Point,
  shape: 'shed' | 'gable' = 'shed',
): { roof: Roof; walls: Wall[]; outline: Point[] } | null {
  const model = rawRoofModel(home, main)
  const surface = roofSurfaceAt(model, a)
  if (!surface || surface.slope < (10 * Math.PI) / 180 || surface.slope > (80 * Math.PI) / 180) return null
  const { dir, up } = surface
  const toUv = (p: Point): Point => [p[0] * dir[0] + p[1] * dir[1], p[0] * up[0] + p[1] * up[1]]
  const toPlan = ([u, v]: Point): Point => [u * dir[0] + v * up[0], u * dir[1] + v * up[1]]
  const [ua, va] = toUv(a)
  const [ub, vb] = toUv(b)
  const u0 = Math.min(ua, ub)
  const u1 = Math.max(ua, ub)
  if (u1 - u0 < 60) return null
  const v0 = Math.min(va, vb)
  const front = toPlan([(u0 + u1) / 2, v0])
  const mainTop = planeZ(surface.plane, front)
  const slope = shape === 'shed' ? Math.min((15 * Math.PI) / 180, surface.slope / 2) : surface.slope
  const thickness = main.thickness
  // Das Gaubendach trifft das Hauptdach hinten am Rechteck, höchstens kurz unter dem First. Daraus
  // folgt die Höhe der Front h über der Unterseite des Hauptdachs: Die Oberseite der Gaube liegt an der
  // Front um h − Versatz + extra über dem Hauptdach und steigt um climb je cm langsamer als dieses.
  const extra = thickness / Math.cos(slope) + (shape === 'gable' ? ((u1 - u0) / 2) * Math.tan(slope) : 0)
  const climb = Math.tan(surface.slope) - (shape === 'shed' ? Math.tan(slope) : 0)
  const vMax = Math.max(...surface.rings[0].map((p) => toUv(p)[1])) - 20
  const heightFor = (meet: number) => climb * meet + surface.offset - extra
  let meet = Math.min(Math.max(va, vb), vMax) - v0
  if (heightFor(meet) < DORMER_MIN_FRONT) meet = Math.min(vMax - v0, (DORMER_MIN_FRONT - surface.offset + extra) / climb)
  const frontHeight = heightFor(meet)
  if (!(frontHeight >= 30)) return null
  const eave = mainTop - surface.offset + frontHeight
  const v1 = v0 + meet + 30
  const outline = ([[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as Point[]).map(toPlan).map(([x, y]): Point => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])

  // Wände innen an der Außenkante: links (hinten → vorn), Front, rechts (vorn → hinten)
  const t = DORMER_WALL_THICKNESS
  const corners = ([[u0 + t / 2, v1], [u0 + t / 2, v0 + t / 2], [u1 - t / 2, v0 + t / 2], [u1 - t / 2, v1]] as Point[]).map(toPlan)
  const ids = [newId('wall'), newId('wall'), newId('wall')]
  const walls: Wall[] = ids.map((id, i) => ({
    id,
    xStart: Math.round(corners[i][0] * 10) / 10,
    yStart: Math.round(corners[i][1] * 10) / 10,
    xEnd: Math.round(corners[i + 1][0] * 10) / 10,
    yEnd: Math.round(corners[i + 1][1] * 10) / 10,
    wallAtStart: i > 0 ? ids[i - 1] : null,
    wallAtEnd: i < 2 ? ids[i + 1] : null,
    thickness: t,
    height: null,
    level: main.level,
    toRoof: true,
  }))
  const base: Roof = {
    ...createRoof(outline, main.level, shape),
    baseHeight: Math.round(eave * 10) / 10,
    slope,
    overhang: 20,
    thickness,
    top: main.top,
    underside: main.underside,
    sides: main.sides,
    dormer: { roofId: main.id, wallIds: ids },
  }
  const roof = { ...base, ...shapeEdges(base, shape) }
  // Hinten im Hauptdach ohne Überstand
  roof.edges = roof.edges.map((e, i) => (i === 2 ? { ...e, overhang: 0 } : e))
  return { roof, walls, outline }
}
