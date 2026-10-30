/**
 * Gewichtetes Straight Skeleton mit Profilen (procedural extrusion nach Kelly & Wonka, „Interactive
 * Architectural Modeling with Procedural Extrusions“, 2011): Die Kanten eines Grundrisses wandern
 * mit steigender Höhe z nach innen, jede mit ihrer eigenen Neigung. Wo sich die Wellenfront trifft,
 * entstehen First, Grate und Kehlen. Ein senkrechter Abschnitt (Neigung 90°) bleibt stehen (Giebel);
 * ab einer Profilhöhe kann eine Kante die Neigung wechseln (Krüppelwalm, Mansarde).
 *
 * Rein geometrisch, ohne three.js; Längen in cm, Winkel in Radiant, Plan-Koordinaten (x, y) und Höhe z.
 */
import type { Point } from './geometry'

export type Point3 = [number, number, number]

/** Ebene a·x + b·y + c·z = d. */
export interface Plane {
  a: number
  b: number
  c: number
  d: number
}

/**
 * Abschnitt des Profils einer Kante: Ab Höhe {@code z} liegt ihre Fläche auf der Ebene durch die
 * um {@code d} nach innen versetzte Kante in Höhe {@code z} mit der Neigung {@code slope}.
 * Der erste Abschnitt gilt auch unterhalb seiner Höhe.
 */
export interface SkeletonStep {
  z: number
  d: number
  slope: number
}

/** Fläche zu Kante {@code edge} des Rings {@code ring} im Profilabschnitt {@code step}. */
export interface SkeletonFace {
  ring: number
  edge: number
  step: number
  plane: Plane
  polygon: Point3[]
}

export interface Skeleton {
  faces: SkeletonFace[]
  /** Waagrechte Restflächen bei {@code zMax} (bzw. wo nichts mehr steigt), als Ringe mit Umlaufsinn wie die Eingabe. */
  top: Point[][]
  /** Höhe, bei der die Wellenfront endete. */
  zEnd: number
}

const EPS = 1e-6

/** Kante der ursprünglichen Ringe; mehrere Abschnitte der Wellenfront können zur selben gehören. */
interface Edge {
  ring: number
  index: number
  dir: Point
  /** Nach innen (links der Richtung). */
  normal: Point
  base: Point
  steps: SkeletonStep[]
  planes: Plane[]
  step: number
}

/** Ecke der Wellenfront zwischen den Kanten {@code left} (davor) und {@code right} (danach). */
interface Vertex {
  left: Edge
  right: Edge
  prev: Vertex
  next: Vertex
  /** Anfang des noch nicht ausgegebenen Wegs dieser Ecke. */
  start: Point3
  alive: boolean
}

function planeOf(edge: Pick<Edge, 'normal' | 'base'>, step: SkeletonStep): Plane {
  const [nx, ny] = edge.normal
  const px = edge.base[0] + nx * step.d
  const py = edge.base[1] + ny * step.d
  const sin = Math.sin(step.slope)
  const cos = Math.abs(step.slope - Math.PI / 2) < 1e-9 ? 0 : Math.cos(step.slope)
  return { a: sin * nx, b: sin * ny, c: -cos, d: sin * (nx * px + ny * py) - cos * step.z }
}

const plane = (edge: Edge) => edge.planes[edge.step]

/** Punkt auf beiden Ebenen in Höhe z; {@code null} bei (fast) parallelen Kanten. */
function onPlanes(l: Plane, r: Plane, z: number): Point | null {
  const det = l.a * r.b - r.a * l.b
  if (Math.abs(det) < 1e-10) return null
  const e = l.d - l.c * z
  const f = r.d - r.c * z
  return [(e * r.b - f * l.b) / det, (l.a * f - r.a * e) / det]
}

function intersect3(p: Plane, q: Plane, r: Plane): Point3 | null {
  const det = p.a * (q.b * r.c - q.c * r.b) - p.b * (q.a * r.c - q.c * r.a) + p.c * (q.a * r.b - q.b * r.a)
  if (Math.abs(det) < 1e-10) return null
  const x = (p.d * (q.b * r.c - q.c * r.b) - p.b * (q.d * r.c - q.c * r.d) + p.c * (q.d * r.b - q.b * r.d)) / det
  const y = (p.a * (q.d * r.c - q.c * r.d) - p.d * (q.a * r.c - q.c * r.a) + p.c * (q.a * r.d - q.d * r.a)) / det
  const z = (p.a * (q.b * r.d - q.d * r.b) - p.b * (q.a * r.d - q.d * r.a) + p.d * (q.a * r.b - q.b * r.a)) / det
  return [x, y, z]
}

const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]

function signedArea(ring: Point[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return sum / 2
}

/**
 * Berechnet die Dachflächen. {@code rings[0]} ist der Umriss, weitere Ringe sind Löcher (Innenhöfe);
 * der Umlaufsinn wird angepasst. {@code steps[r][i]} ist das Profil der Kante von {@code rings[r][i]}
 * nach {@code rings[r][i + 1]} mit aufsteigenden Höhen. {@code zStart}: Höhe, ab der gerechnet wird
 * (unterste Traufe); {@code zMax}: Höhe, ab der das Dach flach ist.
 */
export function straightSkeleton(rings: Point[][], steps: SkeletonStep[][][], zStart: number, zMax: number | null = null): Skeleton {
  const edges: Edge[] = []
  const vertices: Vertex[] = []
  const segments = new Map<string, { edge: Edge; step: number; list: [Point3, Point3][] }>()
  const top: Point[][] = []

  const faceKey = (edge: Edge, step = edge.step) => {
    const key = `${edge.ring}:${edge.index}:${step}`
    let entry = segments.get(key)
    if (!entry) segments.set(key, (entry = { edge, step, list: [] }))
    return entry
  }
  const emit = (a: Point3, b: Point3, ...faces: ReturnType<typeof faceKey>[]) => {
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-7) return
    for (const face of faces) face.list.push([a, b])
  }

  // Ringe so drehen, dass das Dach links jeder Kante liegt (Umriss positiv, Löcher negativ)
  rings.forEach((input, r) => {
    const n = input.length
    if (n < 3) return
    const reversed = r === 0 ? signedArea(input) < 0 : signedArea(input) > 0
    const ring = reversed ? [...input].reverse() : input
    const ringEdges: Edge[] = []
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const dir: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
      // Umgedreht läuft Kante i von ring[i] nach ring[i+1] = input[n-1-i] nach input[n-2-i]: ursprünglich Kante n-2-i
      const index = reversed ? (2 * n - 2 - i) % n : i
      const edgeSteps = steps[r]?.[index] ?? [{ z: zStart, d: 0, slope: Math.PI / 4 }]
      const edge: Edge = { ring: r, index, dir, normal: [-dir[1], dir[0]], base: a, steps: edgeSteps, planes: [], step: 0 }
      edge.planes = edgeSteps.map((s) => planeOf(edge, s))
      ringEdges.push(edge)
      edges.push(edge)
    }
    const ringVertices = ringEdges.map((right, i): Vertex => {
      const left = ringEdges[(i + n - 1) % n]
      const p = onPlanes(plane(left), plane(right), zStart) ?? ring[i]
      return { left, right, prev: null!, next: null!, start: [p[0], p[1], zStart], alive: true }
    })
    ringVertices.forEach((v, i) => {
      v.prev = ringVertices[(i + n - 1) % n]
      v.next = ringVertices[(i + 1) % n]
    })
    vertices.push(...ringVertices)
  })

  const position = (v: Vertex, z: number): Point3 => {
    const p = onPlanes(plane(v.left), plane(v.right), z)
    return p ? [p[0], p[1], z] : [v.start[0], v.start[1], z]
  }
  const live = () => vertices.filter((v) => v.alive)
  const kill = (v: Vertex) => (v.alive = false)
  const link = (a: Vertex, b: Vertex) => {
    a.next = b
    b.prev = a
  }
  const newVertex = (left: Edge, right: Edge, p: Point3): Vertex => {
    const v: Vertex = { left, right, prev: null!, next: null!, start: p, alive: true }
    vertices.push(v)
    return v
  }

  // Unterkanten der Flächen
  for (const v of vertices) emit(v.start, v.next.start, faceKey(v.right))

  /** Wellenfront an Stellen ohne Fläche aufräumen: Mini-Ringe, Spitzen, Kanten der Länge 0. */
  const cleanUp = (z: number) => {
    for (let changed = true, guard = 0; changed && guard < 10000; guard++) {
      changed = false
      for (const v of live()) {
        if (!v.alive) continue
        if (v.next === v) {
          kill(v)
          changed = true
          continue
        }
        if (v.next.next === v) {
          // Ring aus zwei Ecken: dazwischen bleibt ein First
          emit(v.start, v.next.start, faceKey(v.left), faceKey(v.right))
          kill(v.next)
          kill(v)
          changed = true
          continue
        }
        const l = v.left.dir
        const r = v.right.dir
        if (Math.abs(cross(l, r)) < 1e-9) {
          if (dot(l, r) < 0) {
            // Spitze: Die beiden Kanten liegen in dieser Höhe auf derselben Geraden und heben sich
            // auf ihrer Überlappung auf (waagrechter First)
            const p = v.prev
            const q = v.next
            const dp = Math.hypot(p.start[0] - v.start[0], p.start[1] - v.start[1])
            const dq = Math.hypot(q.start[0] - v.start[0], q.start[1] - v.start[1])
            if (dp <= dq) {
              emit(v.start, p.start, faceKey(v.left), faceKey(v.right))
              p.right = v.right
              link(p, q)
              kill(v)
              if (Math.abs(dp - dq) < 1e-6 && p !== q) {
                // Beide Seiten gleich lang: auch die Nachbarn treffen sich
                p.right = q.right
                link(p, q.next)
                kill(q)
              }
            } else {
              emit(v.start, q.start, faceKey(v.left), faceKey(v.right))
              q.left = v.left
              link(p, q)
              kill(v)
            }
            changed = true
            continue
          }
          // Gleich gerichtete Nachbarkanten liegen in dieser Höhe auf einer Geraden. Bei gleicher Ebene ist
          // die Ecke keine; sonst überholt die flachere (schnellere) Kante die steilere, deren Abschnitt
          // hier endet
          const pl = plane(v.left)
          const pr = plane(v.right)
          const same = Math.abs(pl.d - pr.d) < 1e-6 && Math.abs(pl.c - pr.c) < 1e-9
          if (same || Math.abs(pl.c) >= Math.abs(pr.c)) {
            if (!same) emit(v.start, v.next.start, faceKey(v.left), faceKey(v.right))
            v.next.left = v.left
          } else {
            emit(v.prev.start, v.start, faceKey(v.left), faceKey(v.right))
            v.prev.right = v.right
          }
          link(v.prev, v.next)
          kill(v)
          changed = true
          continue
        }
        const w = v.next
        if (Math.hypot(w.start[0] - v.start[0], w.start[1] - v.start[1]) < 1e-6 && v.left !== w.right) {
          // Kante der Länge 0, die nicht wieder wächst: wie ein Kantenereignis zusammenlegen
          const a = position(v, z + 1)
          const b = position(w, z + 1)
          if ((b[0] - a[0]) * v.right.dir[0] + (b[1] - a[1]) * v.right.dir[1] <= 1e-6) {
            const n = newVertex(v.left, w.right, v.start)
            link(v.prev, n)
            link(n, w.next)
            kill(v)
            kill(w)
            changed = true
          }
        }
      }
    }
  }

  let z = zStart
  cleanUp(z)
  const limit = 50 * (vertices.length + 10) ** 2
  for (let iteration = 0; iteration < limit; iteration++) {
    const current = live()
    if (current.length === 0) break
    type Event =
      | { kind: 'edge'; z: number; v: Vertex; p: Point3 }
      | { kind: 'split'; z: number; v: Vertex; u: Vertex; p: Point3 }
      | { kind: 'step'; z: number; edge: Edge }
      | { kind: 'top'; z: number }
    let best = null as Event | null
    const consider = (event: Event) => {
      if (event.z > z - EPS && (!best || event.z < best.z - 1e-9)) best = event
    }

    const active = new Set(current.map((v) => v.right))
    for (const edge of active) {
      const next = edge.steps[edge.step + 1]
      if (next) consider({ kind: 'step', z: Math.max(next.z, z), edge })
    }
    for (const v of current) {
      const w = v.next
      if (v.left === w.right) continue
      const p = intersect3(plane(v.left), plane(v.right), plane(w.right))
      if (!p || p[2] <= z - EPS) continue
      // Nur Kanten, die schrumpfen (heute positive Länge)
      const length = (w.start[0] - v.start[0]) * v.right.dir[0] + (w.start[1] - v.start[1]) * v.right.dir[1]
      if (length < -1e-6) continue
      consider({ kind: 'edge', z: Math.max(p[2], z), v, p })
    }
    for (const v of current) {
      if (cross(v.left.dir, v.right.dir) > -1e-9) continue
      for (const u of current) {
        const edge = u.right
        if (edge === v.left || edge === v.right || u === v || u.next === v) continue
        const p = intersect3(plane(v.left), plane(v.right), plane(edge))
        if (!p || p[2] <= z - EPS || (best && p[2] >= (best as Event).z)) continue
        const a = position(u, p[2])
        const b = position(u.next, p[2])
        const ta = a[0] * edge.dir[0] + a[1] * edge.dir[1]
        const tb = b[0] * edge.dir[0] + b[1] * edge.dir[1]
        const tp = p[0] * edge.dir[0] + p[1] * edge.dir[1]
        if (tb - ta < 1e-6 || tp < ta - 1e-6 || tp > tb + 1e-6) continue
        // Die Ecke muss die Kante von innen treffen, nicht von hinten
        const side = (v.start[0] - u.start[0]) * edge.normal[0] + (v.start[1] - u.start[1]) * edge.normal[1]
        if (side < -1e-6) continue
        consider({ kind: 'split', z: Math.max(p[2], z), v, u, p })
      }
    }
    if (zMax !== null) consider({ kind: 'top', z: Math.max(zMax, z) })
    // Nichts steigt mehr (z. B. nur Giebel): flacher Abschluss
    const event: Event = (best as Event | null) ?? { kind: 'top', z }

    // Alle Ecken bis zur Ereignishöhe ziehen
    for (const v of current) {
      const p = position(v, event.z)
      emit(v.start, p, faceKey(v.left), faceKey(v.right))
      v.start = p
    }
    z = event.z

    if (event.kind === 'top') {
      for (const v of current) emit(v.start, v.next.start, faceKey(v.right))
      const seen = new Set<Vertex>()
      for (const v of current) {
        if (seen.has(v)) continue
        const ring: Point[] = []
        for (let u = v; !seen.has(u); u = u.next) {
          seen.add(u)
          ring.push([u.start[0], u.start[1]])
        }
        if (ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-4) top.push(ring)
      }
      current.forEach(kill)
      break
    }
    if (event.kind === 'step') {
      const { edge } = event
      for (const v of current) if (v.right === edge) emit(v.start, v.next.start, faceKey(edge), faceKey(edge, edge.step + 1))
      edge.step++
    } else if (event.kind === 'edge') {
      const { v } = event
      const w = v.next
      const p: Point3 = [v.start[0], v.start[1], z]
      const n = newVertex(v.left, w.right, p)
      link(v.prev, n)
      link(n, w.next)
      kill(v)
      kill(w)
    } else {
      const { v, u } = event
      const p: Point3 = [event.p[0], event.p[1], z]
      const b = u.next
      const vp = v.prev
      const vn = v.next
      const v1 = newVertex(v.left, u.right, p)
      const v2 = newVertex(u.right, v.right, p)
      link(vp, v1)
      link(v1, b)
      link(u, v2)
      link(v2, vn)
      kill(v)
    }
    cleanUp(z)
  }

  // Flächen auf derselben Ebene (kollineare Kanten gleicher Neigung) gehören zusammen, ihre
  // gemeinsamen Strecken liegen dann innen
  const groups = new Map<string, { edge: Edge; step: number; sources: [Point3, Point3][][] }>()
  for (const { edge, step, list } of segments.values()) {
    const { a, b, c, d } = edge.planes[step]
    const key = [a, b, c].map((v) => Math.round(v * 1e6)).join(',') + ',' + Math.round(d * 1e3)
    const group = groups.get(key)
    if (group) group.sources.push(list)
    else groups.set(key, { edge, step, sources: [list] })
  }
  const faces: SkeletonFace[] = []
  for (const { edge, step, sources } of groups.values()) {
    for (const polygon of chainSegments(sources)) faces.push({ ring: edge.ring, edge: edge.index, step, plane: edge.planes[step], polygon })
  }
  return { faces, top, zEnd: z }
}

/**
 * Fügt Strecken zu geschlossenen Polygonen zusammen und entfernt Punkte auf Geraden. Strecken, die in
 * mehreren Quellen vorkommen, trennen Teilflächen derselben Ebene und fallen weg.
 */
export function chainSegments(sources: [Point3, Point3][][]): Point3[][] {
  const key = (p: Point3) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`
  const unique = new Map<string, { segment: [Point3, Point3]; sources: Set<number> }>()
  sources.forEach((segments, source) => {
    for (const [a, b] of segments) {
      const ka = key(a)
      const kb = key(b)
      if (ka === kb) continue
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const entry = unique.get(k)
      if (entry) entry.sources.add(source)
      else unique.set(k, { segment: [a, b], sources: new Set([source]) })
    }
  })
  const byPoint = new Map<string, { segment: number; other: Point3 }[]>()
  const list = [...unique.values()].filter((e) => e.sources.size === 1).map((e) => e.segment)
  list.forEach(([a, b], i) => {
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const k = key(p)
      if (!byPoint.has(k)) byPoint.set(k, [])
      byPoint.get(k)!.push({ segment: i, other: q })
    }
  })
  const used = new Set<number>()
  const loops: Point3[][] = []
  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue
    used.add(i)
    const [first, second] = list[i]
    const loop: Point3[] = [first]
    let current = second
    let previous = first
    for (let guard = 0; guard < list.length; guard++) {
      if (key(current) === key(first)) break
      loop.push(current)
      const options = (byPoint.get(key(current)) ?? []).filter((o) => !used.has(o.segment))
      if (options.length === 0) break
      // An Knoten mit mehreren Möglichkeiten die schärfste Linkskurve nehmen (bleibt in der Fläche)
      let choice = options[0]
      if (options.length > 1) {
        const incoming = [current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]]
        let bestTurn = -Infinity
        for (const option of options) {
          const out = [option.other[0] - current[0], option.other[1] - current[1], option.other[2] - current[2]]
          const turn = Math.atan2(incoming[0] * out[1] - incoming[1] * out[0], incoming[0] * out[0] + incoming[1] * out[1] + incoming[2] * out[2])
          if (turn > bestTurn) {
            bestTurn = turn
            choice = option
          }
        }
      }
      used.add(choice.segment)
      previous = current
      current = choice.other
    }
    if (key(current) !== key(first)) continue
    const simplified = removeCollinear(loop)
    if (simplified.length >= 3) loops.push(simplified)
  }
  return loops
}

function removeCollinear(loop: Point3[]): Point3[] {
  const result = [...loop]
  for (let changed = true; changed && result.length > 3; ) {
    changed = false
    for (let i = 0; i < result.length && result.length > 3; i++) {
      const a = result[(i + result.length - 1) % result.length]
      const b = result[i]
      const c = result[(i + 1) % result.length]
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const w = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]
      const cx = u[1] * w[2] - u[2] * w[1]
      const cy = u[2] * w[0] - u[0] * w[2]
      const cz = u[0] * w[1] - u[1] * w[0]
      const lu = Math.hypot(u[0], u[1], u[2])
      const lw = Math.hypot(w[0], w[1], w[2])
      if (lu < 1e-6 || lw < 1e-6 || Math.hypot(cx, cy, cz) < 1e-6 * lu * lw) {
        result.splice(i, 1)
        changed = true
        i--
      }
    }
  }
  return result
}
