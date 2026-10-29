import type { LightInfo } from '../model/home'

/** Möbelstück aus dem Katalog (Maße in cm), erzeugt von scripts/build-catalog.mjs. */
export interface CatalogPiece {
  id: string
  name: string
  description: string | null
  creator: string | null
  tags: string[]
  icon: string | null
  planIcon: string | null
  model: string | null
  modelRotation: number[][]
  width: number
  depth: number
  height: number
  elevation: number
  dropOnTopElevation: number
  movable: boolean
  resizable: boolean
  deformable: boolean
  texturable: boolean
  horizontallyRotatable: boolean
  backFaceShown: boolean
  color: number | null
  staircaseCutOutShape: string | null
  doorOrWindow: {
    wallThickness: number
    wallDistance: number
    wallCutOutOnBothSides: boolean
    widthDepthDeformable: boolean
    cutOutShape: string | null
    sashes: { xAxis: number; yAxis: number; width: number; startAngle: number; endAngle: number }[]
  } | null
  /** Nur bei Leuchten. */
  light?: LightInfo | null
}

export interface FurnitureCatalog {
  language: string
  categories: { name: string; pieces: CatalogPiece[] }[]
}

export interface TexturesCatalog {
  language: string
  categories: {
    name: string
    textures: { id: string; name: string; creator: string | null; image: string; icon: string; width: number; height: number }[]
  }[]
}

/** Sprachen, für die scripts/build-catalog.mjs einen Katalog erzeugt. */
export const CATALOG_LANGUAGES = ['de', 'en', 'fr', 'es', 'it']

function catalogLanguage(lang: string): string {
  const base = lang.split('-')[0]
  return CATALOG_LANGUAGES.includes(base) ? base : 'en'
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/** Der Katalog liegt als statische Dateien unter /catalog (aus den Sweet Home 3D-JARs erzeugt). */
export const catalogApi = {
  furniture: (lang: string) => getJson<FurnitureCatalog>(`/catalog/furniture-${catalogLanguage(lang)}.json`),
  textures: (lang: string) => getJson<TexturesCatalog>(`/catalog/textures-${catalogLanguage(lang)}.json`),
  /** Dateien mehrteiliger Modelle je Verzeichnis, z. B. „/catalog/resources/curtains/“. */
  modelParts: () => getJson<Record<string, string[]>>('/catalog/model-parts.json'),
}
