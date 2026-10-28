import type { CatalogPiece } from '../api/catalog'
import { newId, type HomePiece } from './home'

/** Erzeugt ein Möbel im Projekt aus einem Katalogeintrag, zentriert auf (x, y). */
export function pieceFromCatalog(piece: CatalogPiece, x: number, y: number): HomePiece {
  return {
    id: newId('piece'),
    catalogId: piece.id,
    name: piece.name,
    x,
    y,
    elevation: piece.elevation,
    angle: 0,
    width: piece.width,
    depth: piece.depth,
    height: piece.height,
    visible: true,
    model: piece.model,
    modelRotation: piece.modelRotation,
    icon: piece.icon,
    planIcon: piece.planIcon,
    doorOrWindow: piece.doorOrWindow !== null,
    doorOrWindowInfo: piece.doorOrWindow && {
      wallThickness: piece.doorOrWindow.wallThickness,
      wallDistance: piece.doorOrWindow.wallDistance,
      widthDepthDeformable: piece.doorOrWindow.widthDepthDeformable,
      // Sweet Home 3D liefert die Flügel bereits relativ zu Breite bzw. Tiefe
      sashes: piece.doorOrWindow.sashes,
    },
    color: piece.color,
    level: null,
  }
}
