import { create } from 'zustand'
import { catalogApi, type CatalogPiece, type FurnitureCatalog } from '../api/catalog'

interface CatalogState {
  language: string | null
  furniture: FurnitureCatalog | null
  error: boolean
  load: (language: string) => Promise<void>
  findPiece: (id: string) => CatalogPiece | undefined
}

/** Möbelkatalog aus public/catalog, einmal je Fenster und Sprache geladen. */
export const useCatalogStore = create<CatalogState>((set, get) => ({
  language: null,
  furniture: null,
  error: false,
  load: async (language) => {
    if (get().language === language) return
    set({ language, error: false })
    try {
      const furniture = await catalogApi.furniture(language)
      if (get().language === language) set({ furniture })
    } catch {
      set({ error: true, language: null })
    }
  },
  findPiece: (id) => get().furniture?.categories.flatMap((c) => c.pieces).find((p) => p.id === id),
}))

/** MIME-Typ für Drag & Drop eines Katalogeintrags (auch zwischen Fenstern). */
export const CATALOG_PIECE_MIME = 'application/x-sweet3d-catalog-piece'
