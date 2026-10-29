import { DoubleSide, ImageLoader, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Texture } from 'three'
import { argbToCss } from '../model/colors'
import { contentKey, isContentRef } from '../model/contents'
import type { Surface, TextureRef } from '../model/home'
import { contentUrl } from '../storage/contents'

const textures = new Map<string, Texture>()
const materials = new Map<string, MeshStandardMaterial>()

/**
 * Textur einer Fläche, je Bild und Kachelgröße einmal pro Fenster. Die UV-Koordinaten der
 * Geometrien sind in cm, daher wiederholt sich das Bild alle {@code width} × {@code height} cm.
 */
function surfaceTexture(ref: TextureRef): Texture {
  const key = `${ref.image}|${ref.width}|${ref.height}`
  let texture = textures.get(key)
  if (!texture) {
    const created = new Texture()
    created.wrapS = created.wrapT = RepeatWrapping
    created.repeat.set(1 / (ref.width || 100), 1 / (ref.height || 100))
    created.colorSpace = SRGBColorSpace
    created.anisotropy = 4
    void (isContentRef(ref.image) ? contentUrl(contentKey(ref.image)) : Promise.resolve(ref.image))
      .then((url) => (url ? new ImageLoader().loadAsync(url) : null))
      .then((image) => {
        if (!image) return
        created.image = image
        created.needsUpdate = true
      })
      .catch(() => {})
    textures.set(key, created)
    texture = created
  }
  return texture
}

/**
 * Material für eine Fläche mit Farbe oder Textur aus dem Projekt, sonst {@code fallback}. Ausgewählte
 * Flächen werden in der Auswahlfarbe getönt. Materialien gleichen Aussehens werden geteilt.
 */
export function surfaceMaterial(surface: Surface | null | undefined, fallback: string, highlight: string | null = null): MeshStandardMaterial {
  const texture = surface?.texture ?? null
  const color = highlight ?? (surface?.color != null ? argbToCss(surface.color) : texture ? '#ffffff' : fallback)
  const key = `${color}|${texture ? `${texture.image}|${texture.width}|${texture.height}` : ''}`
  let material = materials.get(key)
  if (!material) {
    material = new MeshStandardMaterial({ color, side: DoubleSide, map: texture ? surfaceTexture(texture) : null })
    materials.set(key, material)
  }
  return material
}
