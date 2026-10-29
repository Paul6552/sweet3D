import { create } from 'zustand'
import { catalogApi, type CatalogPiece, type CatalogTexture, type FurnitureCatalog, type TexturesCatalog } from '../api/catalog'
import { libraryFurniture, libraryTextures, listLibraries, type StoredLibrary } from './libraries'

interface CatalogState {
  language: string | null
  /** Standardkatalog und alle importierten Bibliotheken; gleichnamige Kategorien zusammengelegt. */
  furniture: FurnitureCatalog | null
  textures: TexturesCatalog | null
  libraries: StoredLibrary[]
  error: boolean
  load: (language: string) => Promise<void>
  /** Nach Import oder Löschen einer Bibliothek (auch in einem anderen Fenster). */
  reloadLibraries: () => Promise<void>
  findPiece: (id: string) => CatalogPiece | undefined
  findTexture: (id: string) => CatalogTexture | undefined
}

/** Fügt Kategorien gleichen Namens zusammen, die erste Reihenfolge bleibt. */
function merge<T>(lists: { name: string; items: T[] }[][]): { name: string; items: T[] }[] {
  const byName = new Map<string, T[]>()
  for (const list of lists) {
    for (const { name, items } of list) byName.set(name, [...(byName.get(name) ?? []), ...items])
  }
  return [...byName].map(([name, items]) => ({ name, items }))
}

let builtin: { language: string; furniture: FurnitureCatalog; textures: TexturesCatalog } | null = null

function combine(language: string, libraries: StoredLibrary[]) {
  if (!builtin) return null
  const furniture = merge([
    builtin.furniture.categories.map((c) => ({ name: c.name, items: c.pieces })),
    ...libraries.map((l) => libraryFurniture(l, language).map((c) => ({ name: c.name, items: c.pieces }))),
  ])
  const textures = merge([
    builtin.textures.categories.map((c) => ({ name: c.name, items: c.textures })),
    ...libraries.map((l) => libraryTextures(l, language).map((c) => ({ name: c.name, items: c.textures }))),
  ])
  return {
    furniture: { language, categories: furniture.map(({ name, items }) => ({ name, pieces: items })) },
    textures: { language, categories: textures.map(({ name, items }) => ({ name, textures: items })) },
  }
}

let pending: Promise<void> | null = null

async function loadCatalog(language: string) {
  const { getState: get, setState: set } = useCatalogStore
  try {
    const [furniture, textures, libraries] = await Promise.all([
      catalogApi.furniture(language),
      catalogApi.textures(language).catch((): TexturesCatalog => ({ language, categories: [] })),
      listLibraries().catch(() => []),
    ])
    if (get().language !== language) return
    builtin = { language, furniture, textures }
    set({ libraries, ...combine(language, libraries) })
  } catch {
    pending = null
    set({ error: true, language: null })
  }
}

/** Benachrichtigt andere Fenster, wenn sich die Bibliotheken ändern. */
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('sweet3d-libraries')

/** Möbel- und Texturkatalog aus public/catalog und IndexedDB, einmal je Fenster und Sprache geladen. */
export const useCatalogStore = create<CatalogState>((set, get) => ({
  language: null,
  furniture: null,
  textures: null,
  libraries: [],
  error: false,
  load: (language) => {
    // Laufendes Laden abwarten statt sofort zurückzukehren (z. B. beim Import direkt nach dem Start)
    if (get().language === language && pending) return pending
    set({ language, error: false })
    pending = loadCatalog(language)
    return pending
  },
  reloadLibraries: async () => {
    const libraries = await listLibraries()
    const language = get().language
    set({ libraries, ...(language ? combine(language, libraries) : {}) })
  },
  findPiece: (id) => get().furniture?.categories.flatMap((c) => c.pieces).find((p) => p.id === id),
  findTexture: (id) => get().textures?.categories.flatMap((c) => c.textures).find((t) => t.id === id),
}))

/** Nach eigenen Änderungen an Bibliotheken aufrufen: lädt sie hier und in allen anderen Fenstern neu. */
export async function librariesChanged() {
  await useCatalogStore.getState().reloadLibraries()
  channel?.postMessage('changed')
}

channel?.addEventListener('message', () => void useCatalogStore.getState().reloadLibraries())

/** Katalog in der Sprache laden (falls noch nicht geschehen) und zurückgeben. */
export async function loadedCatalog(language: string) {
  await useCatalogStore.getState().load(language)
  const { furniture, textures, libraries } = useCatalogStore.getState()
  return { pieces: furniture?.categories.flatMap((c) => c.pieces) ?? [], textures, libraries }
}

/** MIME-Typ für Drag & Drop eines Katalogeintrags (auch zwischen Fenstern). */
export const CATALOG_PIECE_MIME = 'application/x-sweet3d-catalog-piece'
