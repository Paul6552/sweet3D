import type { MultiPolygon, Polygon, Ring } from 'polygon-clipping'
import { clipping } from './clipping'
import { pointInPolygon, projectOnSegment, wallPolygon, type Point } from './geometry'
import type { Home, Surface, TerrainArea } from './home'
import { visibleLevels } from './levels'

/**
 * Terrain made of areas at their own height (terraces) or rising as tilted planes (ramps). The
 * terrain is flat at height 0 except where areas lie; later areas take precedence over earlier
 * ones. An area with a vertical edge ends in a rock face or retaining wall, one with a slope edge
 * runs down (or up) to the terrain around it outside its outline. An area that follows the terrain
 * (drape) changes no heights and only lays its surface on what lies below it.
 *
 * All functions are pure; the 3D view builds its meshes from {@link terrainPatches} and
 * {@link terrainFaces}.
 */

/** Default slope 1:1.5 (about 34°), a common embankment. */
export const DEFAULT_SLOPE_ANGLE = Math.atan(1 / 1.5)

/** Half size of the base ground in cm (the ground of the 3D view reaches to the horizon). */
export const TERRAIN_EXTENT = 200000

/** Distance in cm at which slopes and faces are subdivided, so they follow the terrain around them. */
export const TERRAIN_STEP = 100

/** Height differences below this (cm) need no vertical face. */
const FACE_THRESHOLD = 0.5

/** Offset in cm for looking at the terrain on either side of an edge. */
const SIDE_OFFSET = 0.5

const CIRCLE_SEGMENTS = 16

type Terrain = Pick<TerrainArea, 'points' | 'elevation' | 'edge' | 'slopeAngle' | 'rampAngle' | 'rampLow' | 'drape'>[]
type AreaShape = Pick<TerrainArea, 'points' | 'elevation' | 'rampAngle' | 'rampLow'>

export function closedRing(points: Point[]): Ring {
  const [first, last] = [points[0], points[points.length - 1]]
  return (first[0] === last[0] && first[1] === last[1] ? points : [...points, first]) as Ring
}

export function pointInMultiPolygon(point: Point, polygons: MultiPolygon): boolean {
  return polygons.some(([outer, ...holes]) => pointInPolygon(point, outer as Point[]) && !holes.some((hole) => pointInPolygon(point, hole as Point[])))
}

/** Point of the outline closest to {@code point} and its distance. */
function nearestOnOutline(point: Point, outline: Point[]): { point: Point; distance: number } {
  let best = { point: outline[0], distance: Infinity }
  for (let i = 0; i < outline.length; i++) {
    const nearest = projectOnSegment(point, outline[i], outline[(i + 1) % outline.length]).point
    const distance = Math.hypot(point[0] - nearest[0], point[1] - nearest[1])
    if (distance < best.distance) best = { point: nearest, distance }
  }
  return best
}

export function isRamp(area: Pick<TerrainArea, 'rampAngle'>): boolean {
  return area.rampAngle !== null && area.rampAngle !== undefined
}

/** Range of the outline along the direction of a ramp. */
export function rampExtent(points: Point[], angle: number): { min: number; max: number } {
  const along = points.map(([x, y]) => x * Math.cos(angle) + y * Math.sin(angle))
  return { min: Math.min(...along), max: Math.max(...along) }
}

/**
 * Height of an area at a point of its outline or inside it: constant for a flat area, for a ramp
 * linear from its lowest to its highest point along the direction of the ramp.
 */
export function rampHeight(area: AreaShape, [x, y]: Point): number {
  if (!isRamp(area)) return area.elevation
  const angle = area.rampAngle!
  const { min, max } = rampExtent(area.points, angle)
  if (max <= min) return area.elevation
  const t = (x * Math.cos(angle) + y * Math.sin(angle) - min) / (max - min)
  const low = area.rampLow ?? 0
  return low + (area.elevation - low) * Math.max(0, Math.min(1, t))
}

/** Highest point of an area. */
export function areaTop(area: AreaShape): number {
  return isRamp(area) ? Math.max(area.elevation, area.rampLow ?? 0) : area.elevation
}

/** Lowest point of an area. */
export function areaBottom(area: AreaShape): number {
  return isRamp(area) ? Math.min(area.elevation, area.rampLow ?? 0) : area.elevation
}

/** Direction of a new ramp: the first edge drawn is its foot, the area rises into its interior. */
export function defaultRampAngle(points: Point[]): number {
  const [a, b] = points
  const normal = Math.atan2(b[0] - a[0], -(b[1] - a[1]))
  const beside: Point = [(a[0] + b[0]) / 2 + Math.cos(normal) * SIDE_OFFSET, (a[1] + b[1]) / 2 + Math.sin(normal) * SIDE_OFFSET]
  return pointInPolygon(beside, points) ? normal : normal + Math.PI
}

/** Height of the terrain at {@code point} after applying {@code area} on top of {@code under}. */
function areaHeight(area: Terrain[number], point: Point, under: number): number {
  if (area.points.length < 3 || area.drape) return under
  if (pointInPolygon(point, area.points)) return rampHeight(area, point)
  if (area.edge !== 'slope') return under
  const nearest = nearestOnOutline(point, area.points)
  const edge = rampHeight(area, nearest.point)
  const rise = nearest.distance * Math.tan(area.slopeAngle)
  return edge > under ? Math.max(under, edge - rise) : Math.min(under, edge + rise)
}

/** Height of the terrain at a plan point; only the first {@code count} areas are considered. */
export function terrainHeightAt(terrain: Terrain, point: Point, count = terrain.length): number {
  let height = 0
  for (let i = 0; i < count; i++) height = areaHeight(terrain[i], point, height)
  return height
}

/** Points along the outline, at most {@link TERRAIN_STEP} apart. */
export function densify(ring: Point[], step = TERRAIN_STEP, closed = true): Point[] {
  const result: Point[] = []
  const n = closed ? ring.length : ring.length - 1
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let k = 0; k < parts; k++) result.push([a[0] + ((b[0] - a[0]) * k) / parts, a[1] + ((b[1] - a[1]) * k) / parts])
  }
  if (!closed) result.push(ring[ring.length - 1])
  return result
}

/** Points in eight directions around {@code point} at the given distance. */
function around([x, y]: Point, distance: number): Point[] {
  return Array.from({ length: 8 }, (_, k): Point => [x + Math.cos((k * Math.PI) / 4) * distance, y + Math.sin((k * Math.PI) / 4) * distance])
}

/**
 * How far the slope of area {@code index} reaches beyond its outline: until it meets the terrain
 * of the earlier areas. Measured around the outline and refined once at the found distance, as
 * the terrain there may be lower or higher than right at the edge.
 */
export function slopeReach(terrain: Terrain, index: number): number {
  const area = terrain[index]
  if (area.edge !== 'slope' || area.points.length < 3 || area.drape) return 0
  const tan = Math.tan(area.slopeAngle)
  if (!(tan > 0)) return 0
  const samples = densify(area.points)
  let reach = 0
  for (let pass = 0; pass < 3; pass++) {
    let next = 0
    for (const sample of samples) {
      for (const point of [sample, ...around(sample, reach + SIDE_OFFSET)]) {
        if (pointInPolygon(point, area.points)) continue
        next = Math.max(next, Math.abs(rampHeight(area, sample) - terrainHeightAt(terrain, point, index)) / tan)
      }
    }
    if (next <= reach + 1) return Math.max(reach, next)
    reach = next
  }
  return reach
}

/** The outline grown by {@code distance} in all directions (rounded corners). */
export function bufferPolygon(points: Point[], distance: number): MultiPolygon {
  const ring = closedRing(points)
  if (distance <= 0) return [[ring]]
  const parts: Polygon[] = [[ring]]
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length > 0) {
      const nx = (-(b[1] - a[1]) / length) * distance
      const ny = ((b[0] - a[0]) / length) * distance
      parts.push([closedRing([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]])])
    }
    const circle = Array.from({ length: CIRCLE_SEGMENTS }, (_, k): Point => {
      const angle = (2 * Math.PI * k) / CIRCLE_SEGMENTS
      // Slightly larger, so the polygon contains the circle
      const r = distance / Math.cos(Math.PI / CIRCLE_SEGMENTS)
      return [a[0] + Math.cos(angle) * r, a[1] + Math.sin(angle) * r]
    })
    parts.push([closedRing(circle)])
  }
  return clipping.union(parts[0], ...parts.slice(1))
}

/** Plan area an area changes: its outline, with a slope edge also the slope around it. */
export function areaFootprint(terrain: Terrain, index: number, reach = slopeReach(terrain, index)): MultiPolygon {
  const area = terrain[index]
  if (area.points.length < 3) return []
  return reach > 0 ? bufferPolygon(area.points, reach) : [[closedRing(area.points)]]
}

/** Parts of the house that replace the terrain below some height (see {@link houseFootprint}). */
export interface HouseCut {
  /** Union of the outlines of rooms and walls. */
  footprint: MultiPolygon
  /** Outlines of the walls only: they hold the terrain at the edge of the cut. */
  walls: MultiPolygon
  /** Room floors with their level's elevation, for faces down to rooms without walls. */
  floors: { points: Point[]; elevation: number }[]
}

function houseCut(home: Pick<Home, 'levels' | 'selectedLevel' | 'rooms' | 'walls'>, height: number): HouseCut {
  const elevations = new Map(
    visibleLevels(home as Home)
      .filter((l) => (l?.elevation ?? 0) < height)
      .map((l) => [l?.id ?? null, l?.elevation ?? 0]),
  )
  if (elevations.size === 0) return { footprint: [], walls: [], floors: [] }
  const floors = home.rooms.filter((r) => elevations.has(r.level) && r.points.length >= 3).map((r) => ({ points: r.points, elevation: elevations.get(r.level)! }))
  const walls = home.walls.filter((w) => elevations.has(w.level))
  const wallsById = new Map(walls.map((w) => [w.id, w]))
  const wallPolygons: Polygon[] = walls.map((wall) => [closedRing(wallPolygon(wall, wallsById))])
  const polygons: Polygon[] = [...floors.map((f): Polygon => [closedRing(f.points)]), ...wallPolygons]
  return { footprint: union(polygons), walls: union(wallPolygons), floors }
}

function union(polygons: Polygon[]): MultiPolygon {
  if (polygons.length === 0) return []
  try {
    return clipping.union(polygons[0], ...polygons.slice(1))
  } catch {
    // Rather one hole per outline (overlaps then twice) than none
    return polygons
  }
}

/**
 * Union of the outlines of rooms and walls of all visible levels whose floor lies below
 * {@code height}: there the house replaces the terrain (holes like Sweet Home 3D shows above
 * basements). Empty if no such level exists.
 */
export function houseFootprint(home: Pick<Home, 'levels' | 'selectedLevel' | 'rooms' | 'walls'>, height: number): MultiPolygon {
  return houseCut(home, height).footprint
}

/** Visible part of the terrain with one height rule: the base ground, the top of an area or its slope. */
export interface TerrainPatch {
  /** Index of the area in {@code home.terrain}, {@code null} for the base ground. */
  area: number | null
  kind: 'flat' | 'ramp' | 'slope'
  polygons: MultiPolygon
  /** Height of the flat part (0 for the base ground), of a ramp its upper end. */
  elevation: number
  /** Parts of the house cut out of this patch. */
  houseHoles: MultiPolygon
  /** Walls among them: no faces are built along them, the walls hold the terrain. */
  houseWalls: MultiPolygon
  /** Room floors among them; faces along rooms without walls reach down to their floor. */
  houseFloors: HouseCut['floors']
  surface: Surface | null
}

function intersection(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  try {
    return clipping.intersection(a, b)
  } catch {
    return []
  }
}

function difference(a: MultiPolygon, ...b: MultiPolygon[]): MultiPolygon {
  const others = b.filter((m) => m.length > 0)
  if (a.length === 0 || others.length === 0) return a
  try {
    return clipping.difference(a, ...others)
  } catch {
    return a
  }
}

/** Height of a point of a patch: the terrain up to and including its area. */
export function patchHeight(home: Pick<Home, 'terrain'>, patch: Pick<TerrainPatch, 'area' | 'kind' | 'elevation'>, point: Point): number {
  if (patch.kind === 'flat') return patch.elevation
  // Directly from the area: points on its outline count as neither inside nor outside
  if (patch.kind === 'ramp') return rampHeight(home.terrain[patch.area!], point)
  return terrainHeightAt(home.terrain, point, (patch.area ?? -1) + 1)
}

function cutFields(cut: HouseCut): Pick<TerrainPatch, 'houseHoles' | 'houseWalls' | 'houseFloors'> {
  return { houseHoles: cut.footprint, houseWalls: cut.walls, houseFloors: cut.floors }
}

function ringsOf(polygons: MultiPolygon): Point[][] {
  return polygons.flatMap((polygon) => polygon.map((ring) => (ring as Point[]).slice(0, -1)))
}

/**
 * Visible parts of the terrain: later areas cover earlier ones, the house cuts holes wherever a
 * visible level's floor lies below the terrain. Without areas this is the base ground with holes
 * above basements, as before.
 */
export function terrainPatches(home: Pick<Home, 'levels' | 'selectedLevel' | 'rooms' | 'walls' | 'terrain'>): TerrainPatch[] {
  const { terrain } = home
  const patches: TerrainPatch[] = []
  const covered: MultiPolygon[] = []
  for (let i = terrain.length - 1; i >= 0; i--) {
    const area = terrain[i]
    if (area.points.length < 3 || area.drape) continue
    const reach = slopeReach(terrain, i)
    const footprint = areaFootprint(terrain, i, reach)
    const outline: MultiPolygon = [[closedRing(area.points)]]
    const top = areaTop(area)
    const houseTop = houseCut(home, top)
    const flat = difference(outline, ...covered, houseTop.footprint)
    const surface = area.surface ?? null
    if (flat.length > 0) patches.push({ area: i, kind: isRamp(area) ? 'ramp' : 'flat', polygons: flat, elevation: area.elevation, ...cutFields(houseTop), surface })
    if (reach > 0) {
      const band = difference(footprint, outline, ...covered)
      // The house is cut out where its floor lies below the highest point of the slope
      const highest = Math.max(top, ...ringsOf(band).flat().map((p) => terrainHeightAt(terrain, p, i)))
      const houseSlope = houseCut(home, highest)
      const slope = difference(band, houseSlope.footprint)
      if (slope.length > 0) patches.push({ area: i, kind: 'slope', polygons: slope, elevation: area.elevation, ...cutFields(houseSlope), surface })
    }
    covered.push(footprint)
  }
  const square: MultiPolygon = [[closedRing([[-TERRAIN_EXTENT, -TERRAIN_EXTENT], [TERRAIN_EXTENT, -TERRAIN_EXTENT], [TERRAIN_EXTENT, TERRAIN_EXTENT], [-TERRAIN_EXTENT, TERRAIN_EXTENT]])]]
  const houseBase = houseCut(home, 0)
  patches.push({ area: null, kind: 'flat', polygons: difference(square, ...covered, houseBase.footprint), elevation: 0, ...cutFields(houseBase), surface: null })
  return drapedPatches(terrain, patches.reverse())
}

/**
 * Lays the surfaces of the areas that follow the terrain on the patches below them. Each patch is
 * split at the outline and keeps its height rule, so the surface lies exactly on the terrain, also
 * across kinks; there is no second mesh that could flicker with it. Later areas stay on top.
 */
function drapedPatches(terrain: TerrainArea[], patches: TerrainPatch[]): TerrainPatch[] {
  return terrain.reduce((result, area, index) => {
    const surface = area.surface
    if (!area.drape || area.points.length < 3 || !surface || (surface.color == null && !surface.texture)) return result
    const outline: MultiPolygon = [[closedRing(area.points)]]
    return result.flatMap((patch) => {
      if (patch.area !== null && patch.area > index) return [patch]
      const inside = intersection(patch.polygons, outline)
      if (inside.length === 0) return [patch]
      const outside = difference(patch.polygons, outline)
      return [...(outside.length > 0 ? [{ ...patch, polygons: outside }] : []), { ...patch, polygons: inside, surface }]
    })
  }, patches)
}

/** Vertical face where a patch ends higher than the terrain next to it (rock face, retaining wall). */
export interface TerrainFace {
  a: Point
  b: Point
  topA: number
  topB: number
  bottomA: number
  bottomB: number
  /** Area the face belongs to, for its surface. */
  area: number | null
}

/**
 * Vertical faces along the edges of the patches, from the patch down to the lower terrain next to
 * it. Edges along walls of the house get none (the walls hold the terrain); along rooms without
 * walls (e.g. a driveway cut into a terrace) the face reaches down to the room's floor. Edges where
 * the terrain continues at the same height (e.g. into a slope) get none either.
 */
export function terrainFaces(home: Pick<Home, 'terrain'>, patches: TerrainPatch[]): TerrainFace[] {
  const faces: TerrainFace[] = []
  const { terrain } = home
  for (const patch of patches) {
    for (const ring of ringsOf(patch.polygons)) {
      const points = patch.area === null && ring.some(([x, y]) => Math.abs(x) >= TERRAIN_EXTENT || Math.abs(y) >= TERRAIN_EXTENT) ? [] : densify(ring)
      for (let i = 0; i < points.length; i++) {
        const a = points[i]
        const b = points[(i + 1) % points.length]
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (length < 1e-6) continue
        const normal: Point = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
        const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const side = (sign: number): Point => [mid[0] + normal[0] * SIDE_OFFSET * sign, mid[1] + normal[1] * SIDE_OFFSET * sign]
        const insideLeft = pointInMultiPolygon(side(1), patch.polygons)
        const out = insideLeft ? -1 : 1
        if (pointInMultiPolygon(side(out), patch.polygons) || !pointInMultiPolygon(side(-out), patch.polygons)) continue
        const outside = side(out)
        let floor = Infinity
        if (pointInMultiPolygon(outside, patch.houseHoles)) {
          if (pointInMultiPolygon(outside, patch.houseWalls)) continue
          for (const room of patch.houseFloors) if (room.elevation < floor && pointInPolygon(outside, room.points)) floor = room.elevation
        }
        // The terrain continues here: the ends of the edge may lie on the outline of an area and
        // read the terrain beside it, e.g. where a draped surface splits a patch
        else if (Math.abs(patchHeight(home, patch, mid) - terrainHeightAt(terrain, outside)) <= FACE_THRESHOLD) continue
        const beside = (p: Point): Point => [p[0] + normal[0] * SIDE_OFFSET * out, p[1] + normal[1] * SIDE_OFFSET * out]
        const topA = patchHeight(home, patch, a)
        const topB = patchHeight(home, patch, b)
        const lowA = Math.min(floor, terrainHeightAt(terrain, beside(a)))
        const lowB = Math.min(floor, terrainHeightAt(terrain, beside(b)))
        if (topA - lowA <= FACE_THRESHOLD && topB - lowB <= FACE_THRESHOLD) continue
        // The face of the base ground down into a lowered area belongs to that area
        const area = patch.area ?? topAreaAt(home.terrain, beside(mid))
        faces.push({ a, b, topA, topB, bottomA: Math.min(lowA, topA), bottomB: Math.min(lowB, topB), area })
      }
    }
  }
  return faces
}

/** Index of the area that determines the terrain at the point, {@code null} for the base ground. */
export function topAreaAt(terrain: TerrainArea[], point: Point): number | null {
  for (let i = terrain.length - 1; i >= 0; i--) {
    const area = terrain[i]
    if (area.points.length < 3 || area.drape) continue
    if (pointInPolygon(point, area.points)) return i
    if (area.edge === 'slope' && areaHeight(area, point, terrainHeightAt(terrain, point, i)) !== terrainHeightAt(terrain, point, i)) return i
  }
  return null
}

/** Areas that follow a level take its floor height; areas of deleted levels stop following. */
export function settleTerrain(home: Pick<Home, 'terrain' | 'levels'>): void {
  for (const area of home.terrain) {
    if (!area.followLevel) continue
    const level = home.levels.find((l) => l.id === area.followLevel)
    if (!level) area.followLevel = null
    else if (area.elevation !== level.elevation) area.elevation = level.elevation
  }
}
