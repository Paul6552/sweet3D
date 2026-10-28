import axios from 'axios'

/** Möbelstück aus dem Katalog (Maße in cm), siehe CatalogDtos im Backend. */
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

// Der Katalog ist öffentlich, daher ohne Token
export const catalogApi = {
  furniture: (lang: string) =>
    axios.get<FurnitureCatalog>('/api/catalog/furniture', { params: { lang } }).then((r) => r.data),
  textures: (lang: string) =>
    axios.get<TexturesCatalog>('/api/catalog/textures', { params: { lang } }).then((r) => r.data),
}
