import type { CatalogPiece } from '../api/catalog'
import { useCatalogStore } from '../catalog/catalogStore'
import { pieceFromCatalog } from '../model/furniture'
import type { Point } from '../model/geometry'
import type { Home, HomePiece } from '../model/home'
import { skylightPlacement } from '../model/roofs'
import { snapDoorOrWindowToWall } from './magnetism'

/**
 * Tür bzw. Fenster an einer Wand einrasten, sonst als Dachfenster auf einem Dach; ein Dachfenster, das
 * keines mehr ist, steht wieder aufrecht in der Höhe aus dem Katalog.
 */
export function snapDoorOrWindow(home: Home, piece: HomePiece): Partial<HomePiece> | null {
  const upright = piece.roofId || piece.pitch ? { pitch: 0, roofId: null, elevation: useCatalogStore.getState().findPiece(piece.catalogId ?? '')?.elevation ?? 0 } : null
  const wall = snapDoorOrWindowToWall(home, piece)
  if (wall) return { ...wall, ...upright }
  return skylightPlacement(home, piece) ?? upright
}

/** Neues Möbel aus dem Katalog an einem Planpunkt; Türen und Fenster rasten bei Magnetismus an Wänden ein. */
export function catalogPieceAt(home: Home, catalogPiece: CatalogPiece, [x, y]: Point, magnetism: boolean): HomePiece {
  const piece = pieceFromCatalog(catalogPiece, x, y)
  const snapped = magnetism && piece.doorOrWindowInfo ? snapDoorOrWindow(home, { ...piece, level: home.selectedLevel }) : null
  return snapped ? { ...piece, ...snapped } : piece
}
