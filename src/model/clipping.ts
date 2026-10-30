import polygonClipping, { type Geom, type MultiPolygon } from 'polygon-clipping'

/** Raster, auf das Koordinaten gerundet werden, wenn polygon-clipping an ihnen scheitert. */
const GRIDS = [1e6, 1e3]

function snap<T>(geometry: T, grid: number): T {
  if (!Array.isArray(geometry)) return geometry
  if (typeof geometry[0] === 'number') return geometry.map((v: number) => Math.round(v * grid) / grid) as T
  return geometry.map((part) => snap(part, grid)) as T
}

function robust(operation: (geometry: Geom, ...geometries: Geom[]) => MultiPolygon) {
  return (geometry: Geom, ...geometries: Geom[]): MultiPolygon => {
    try {
      return operation(geometry, ...geometries)
    } catch (error) {
      // polygon-clipping scheitert gelegentlich an fast deckungsgleichen Kanten (leicht versetzte
      // Wände, Firste genau auf dem Umriss); auf ein feines Raster gerundet klappt es meist
      for (const grid of GRIDS) {
        try {
          return operation(snap(geometry, grid), ...geometries.map((g) => snap(g, grid)))
        } catch {
          // nächstes, gröberes Raster
        }
      }
      throw error
    }
  }
}

/** polygon-clipping, das bei Rechenfehlern mit gerundeten Koordinaten einen zweiten Versuch macht. */
export const clipping = {
  union: robust(polygonClipping.union),
  intersection: robust(polygonClipping.intersection),
  difference: robust(polygonClipping.difference),
}
