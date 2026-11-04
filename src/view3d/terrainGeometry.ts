import type { MultiPolygon } from 'polygon-clipping'
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Path, Shape, ShapeGeometry, Vector2 } from 'three'
import { clipping } from '../model/clipping'
import type { Point } from '../model/geometry'
import type { Home, Surface } from '../model/home'
import { closedRing, densify, patchHeight, TERRAIN_EXTENT, type TerrainFace, type TerrainPatch } from '../model/terrain'

/**
 * Meshes of the terrain in the local frame of the ground: x = plan x, y = −plan y, z = height,
 * so rotated −90° around x they lie like the ground plane and the ground shader (which reads the
 * local x/y) continues the lawn pattern seamlessly over terraces and slopes. Texture coordinates
 * are in cm like those of walls and floors.
 */

/** Rock for vertical terrain edges unless the area has its own surface. */
export const DEFAULT_ROCK: Surface = {
  // Gray tint: the light sandstone texture alone looks almost white in the sun
  color: 0xffb8b2a8,
  texture: { catalogId: 'eTeks#stone2Wall', name: 'Stone', image: '/catalog/resources/textures/stone2Wall.jpg', width: 160, height: 100 },
}

const toVectors = (ring: Point[]) => ring.map(([x, y]) => new Vector2(x, -y))

/** Size in cm of the tiles the terrain is cut into around the house and the terrain areas. */
const TILE = 1000
/** Margin in cm around the house and the terrain areas that is still cut into tiles. */
const TILE_MARGIN = 2000

/**
 * The polygons cut into tiles around the house and the terrain areas. Triangulated as a whole, the
 * base ground (kilometres wide, with holes) yields long thin triangles whose interpolated depth is
 * too imprecise for floors lying just above it: the lawn then shows through the floors of the
 * lowest level. Far from the house large triangles remain.
 */
function tiled(home: Pick<Home, 'terrain' | 'rooms' | 'walls'>, polygons: MultiPolygon): MultiPolygon {
  const points: Point[] = [
    ...home.terrain.flatMap((a) => a.points),
    ...home.rooms.flatMap((r) => r.points),
    ...home.walls.flatMap((w): Point[] => [[w.xStart, w.yStart], [w.xEnd, w.yEnd]]),
  ]
  if (points.length === 0) return polygons
  const clamp = (v: number) => Math.max(-TERRAIN_EXTENT, Math.min(TERRAIN_EXTENT, v))
  const snap = (v: number, up: boolean) => clamp((up ? Math.ceil(v / TILE) : Math.floor(v / TILE)) * TILE)
  const minX = snap(Math.min(...points.map((p) => p[0])) - TILE_MARGIN, false)
  const maxX = snap(Math.max(...points.map((p) => p[0])) + TILE_MARGIN, true)
  const minY = snap(Math.min(...points.map((p) => p[1])) - TILE_MARGIN, false)
  const maxY = snap(Math.max(...points.map((p) => p[1])) + TILE_MARGIN, true)
  const rect = (x0: number, y0: number, x1: number, y1: number): MultiPolygon => [[closedRing([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])]]
  try {
    const result: MultiPolygon = [...clipping.difference(polygons, rect(minX, minY, maxX, maxY))]
    const inner = clipping.intersection(polygons, rect(minX, minY, maxX, maxY))
    if (inner.length === 0) return result
    for (let x = minX; x < maxX; x += TILE) {
      for (let y = minY; y < maxY; y += TILE) result.push(...clipping.intersection(inner, rect(x, y, x + TILE, y + TILE)))
    }
    return result
  } catch {
    return polygons
  }
}

/** Top surface of a patch: flat at its height, or a slope whose vertices follow the terrain. */
export function patchGeometry(home: Pick<Home, 'terrain' | 'rooms' | 'walls'>, patch: TerrainPatch): BufferGeometry {
  const slope = patch.kind === 'slope'
  const ring = (points: Point[]) => toVectors(slope ? densify(points.slice(0, -1)) : points.slice(0, -1))
  const shapes = tiled(home, patch.polygons).map(([outer, ...inner]) => {
    const shape = new Shape(ring(outer as Point[]))
    shape.holes = inner.map((hole) => new Path(ring(hole as Point[])))
    return shape
  })
  const geometry = new ShapeGeometry(shapes)
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    position.setZ(i, patchHeight(home, patch, [x, -y]))
    uv[2 * i] = x
    uv[2 * i + 1] = y
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  if (slope) geometry.computeVertexNormals()
  return geometry
}

/** Vertical faces as quads from the lower terrain up to the patch; u runs along the edge, v upwards. */
export function facesGeometry(faces: TerrainFace[]): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (const face of faces) {
    const { a, b } = face
    // Continuous texture along straight edges: measure along the main direction of the edge
    const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])
    const u = (p: Point) => (alongX ? p[0] : p[1])
    const base = positions.length / 3
    positions.push(a[0], -a[1], face.bottomA, b[0], -b[1], face.bottomB, b[0], -b[1], face.topB, a[0], -a[1], face.topA)
    uvs.push(u(a), face.bottomA, u(b), face.bottomB, u(b), face.topB, u(a), face.topA)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Texture coordinates for the ground material: like the large ground plane (for the path tracer). */
export function groundUv(geometry: BufferGeometry, size: number): BufferGeometry {
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / size + 0.5, uv.getY(i) / size + 0.5)
  uv.needsUpdate = true
  return geometry
}
