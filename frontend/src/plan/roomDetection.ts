import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { Home } from '../model/home'
import { pointInPolygon, polygonArea, wallPolygon, type Point } from '../model/geometry'

/**
 * Ermittelt den von Wänden umschlossenen Bereich, in dem (x, y) liegt, wie der Doppelklick
 * im Raum-Modus von Sweet Home 3D: Alle Wandflächen werden vereinigt; die Löcher der
 * Vereinigung sind die Räume. Liefert {@code null}, wenn der Punkt in keinem Loch liegt.
 */
export function detectRoom(home: Home, point: Point): Point[] | null {
  if (home.walls.length === 0) return null
  const byId = new Map(home.walls.map((w) => [w.id, w]))
  const polygons: Polygon[] = home.walls.map((w) => {
    const ring = wallPolygon(w, byId)
    return [[...ring, ring[0]]]
  })
  const union = polygonClipping.union(polygons[0], ...polygons.slice(1))
  let best: Point[] | null = null
  for (const polygon of union) {
    for (const hole of polygon.slice(1)) {
      const ring = hole.slice(0, -1) as Point[]
      // Bei verschachtelten Löchern (Wände im Raum) das kleinste passende nehmen
      if (pointInPolygon(point, ring) && (!best || polygonArea(ring) < polygonArea(best))) best = ring
    }
  }
  return best && best.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
}
