import type { MultiPolygon, Polygon } from 'polygon-clipping'
import { BufferAttribute, type BufferGeometry, Path, PlaneGeometry, Shape, ShapeGeometry, Vector2 } from 'three'
import { clipping } from '../model/clipping'
import { wallPolygon, type Point } from '../model/geometry'
import type { Home } from '../model/home'
import { isUnderground, visibleLevels } from '../model/levels'

/**
 * Löcher im Rasen über den Untergeschossen, wie in Sweet Home 3D: Grundrisse der Räume und Wände
 * aller sichtbaren Ebenen unter dem Gelände, vereinigt. Leer, wenn es keine Untergeschosse gibt.
 */
export function groundHoles(home: Pick<Home, 'levels' | 'selectedLevel' | 'rooms' | 'walls'>): MultiPolygon {
  const underground = new Set(
    visibleLevels(home as Home)
      .filter(isUnderground)
      .map((l) => l!.id),
  )
  if (underground.size === 0) return []
  const polygons: Polygon[] = []
  for (const room of home.rooms) if (room.level && underground.has(room.level) && room.points.length >= 3) polygons.push([closed(room.points)])
  const walls = home.walls.filter((w) => w.level && underground.has(w.level))
  const wallsById = new Map(walls.map((w) => [w.id, w]))
  for (const wall of walls) polygons.push([closed(wallPolygon(wall, wallsById))])
  if (polygons.length === 0) return []
  try {
    return clipping.union(polygons[0], ...polygons.slice(1))
  } catch {
    // Lieber ein Loch je Umriss (Überlappungen dann doppelt) als gar keins
    return polygons
  }
}

function closed(points: Point[]): Point[] {
  const [first, last] = [points[0], points[points.length - 1]]
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first]
}

/**
 * Rasenfläche der Kantenlänge {@code size} um den Ursprung mit Löchern, in der Ebene wie eine
 * {@link PlaneGeometry} (lokal y = −Plan-y, damit sie um −90° um x gedreht flach liegt). Die
 * Texturkoordinaten entsprechen denen der PlaneGeometry, damit der Rasen gleich aussieht.
 */
export function groundGeometry(size: number, holes: MultiPolygon): BufferGeometry {
  if (holes.length === 0) return new PlaneGeometry(size, size)
  const half = size / 2
  const toVectors = (ring: Point[]) => ring.slice(0, -1).map(([x, y]) => new Vector2(x, -y))
  const outer = new Shape([new Vector2(-half, -half), new Vector2(half, -half), new Vector2(half, half), new Vector2(-half, half)])
  const shapes = [outer]
  for (const [ring, ...islands] of holes) {
    outer.holes.push(new Shape(toVectors(ring as Point[])))
    // Innenhöfe eines Kellers bleiben Rasen
    for (const island of islands) shapes.push(new Shape(toVectors(island as Point[])))
  }
  const geometry = new ShapeGeometry(shapes)
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    uv[2 * i] = position.getX(i) / size + 0.5
    uv[2 * i + 1] = position.getY(i) / size + 0.5
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  return geometry
}

/**
 * Flat geometry of plan polygons (outer ring plus holes), laid out like {@link groundGeometry}
 * (local y = −plan y, rotated −90° around x it lies flat). Without texture coordinates.
 */
export function polygonsGeometry(polygons: MultiPolygon): ShapeGeometry {
  const toVectors = (ring: Point[]) => ring.slice(0, -1).map(([x, y]) => new Vector2(x, -y))
  const shapes = polygons.map(([outer, ...inner]) => {
    const shape = new Shape(toVectors(outer as Point[]))
    shape.holes = inner.map((ring) => new Path(toVectors(ring as Point[])))
    return shape
  })
  return new ShapeGeometry(shapes)
}
