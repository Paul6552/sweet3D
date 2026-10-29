import {
  DoubleSide,
  ImageLoader,
  type Material,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'
import { argbToCss } from '../model/colors'
import { contentKey, isContentRef } from '../model/contents'
import type { Surface, TextureRef } from '../model/home'
import { contentUrl } from '../storage/contents'
import { patchIndoorLight } from './indoorLight'

/** three.js begrenzt auf das, was die Grafikkarte kann; Texturen bleiben so auch unter flachem Blickwinkel scharf. */
export const MAX_ANISOTROPY = 16

const textures = new Map<string, Texture>()
const materials = new Map<string, MeshStandardMaterial>()

/**
 * Bild einer Flächentextur, je Bild und Kachelgröße einmal pro Fenster. Die UV-Koordinaten der
 * Geometrien sind in cm, daher wiederholt sich das Bild alle {@code width} × {@code height} cm.
 * Nur Farbbilder sind sRGB, Normalen- und Graustufenkarten linear.
 */
function surfaceTexture(image: string, ref: TextureRef, color: boolean): Texture {
  const key = `${image}|${ref.width}|${ref.height}`
  let texture = textures.get(key)
  if (!texture) {
    const created = new Texture()
    created.wrapS = created.wrapT = RepeatWrapping
    created.repeat.set(1 / (ref.width || 100), 1 / (ref.height || 100))
    created.colorSpace = color ? SRGBColorSpace : NoColorSpace
    created.anisotropy = MAX_ANISOTROPY
    void (isContentRef(image) ? contentUrl(contentKey(image)) : Promise.resolve(image))
      .then((url) => (url ? new ImageLoader().loadAsync(url) : null))
      .then((loaded) => {
        if (!loaded) return
        created.image = loaded
        created.needsUpdate = true
      })
      .catch(() => {})
    textures.set(key, created)
    texture = created
  }
  return texture
}

function textureKey(texture: TextureRef): string {
  const maps = texture.maps ?? {}
  return `${texture.image}|${texture.width}|${texture.height}|${maps.normal ?? ''}|${maps.roughness ?? ''}|${maps.ao ?? ''}|${maps.metalness ?? ''}`
}

/**
 * Material für eine Fläche mit Farbe oder Textur aus dem Projekt, sonst {@code fallback}. Ausgewählte
 * Flächen werden in der Auswahlfarbe getönt. Materialien gleichen Aussehens werden geteilt.
 */
export function surfaceMaterial(surface: Surface | null | undefined, fallback: string, highlight: string | null = null): MeshStandardMaterial {
  const texture = surface?.texture ?? null
  const color = highlight ?? (surface?.color != null ? argbToCss(surface.color) : texture ? '#ffffff' : fallback)
  const key = `${color}|${texture ? textureKey(texture) : ''}`
  let material = materials.get(key)
  if (!material) {
    const maps = texture?.maps
    material = patchIndoorLight(new MeshStandardMaterial({
      color,
      side: DoubleSide,
      // Putz, Holz und Stoff glänzen kaum; Karten aus PBR-Texturen übersteuern das
      roughness: maps?.roughness ? 1 : 0.85,
      map: texture ? surfaceTexture(texture.image, texture, true) : null,
      normalMap: texture && maps?.normal ? surfaceTexture(maps.normal, texture, false) : null,
      roughnessMap: texture && maps?.roughness ? surfaceTexture(maps.roughness, texture, false) : null,
      aoMap: texture && maps?.ao ? surfaceTexture(maps.ao, texture, false) : null,
      metalnessMap: texture && maps?.metalness ? surfaceTexture(maps.metalness, texture, false) : null,
      metalness: maps?.metalness ? 1 : 0,
    }))
    materials.set(key, material)
  }
  return material
}

/** Rohwerte einer MTL-Datei je Material, wie MTLLoader sie liest (Schlüssel klein geschrieben). */
export type MtlInfo = Record<string, string | number[] | undefined>

/**
 * Wandelt die Phong-Materialien des MTLLoaders in physikalisch basierte Materialien, damit Modelle
 * vom Umgebungslicht beleuchtet werden und je nach Glanz spiegeln. Rauheit und Metall stammen,
 * soweit vorhanden, aus den PBR-Erweiterungen der MTL-Datei (Pr, Pm, map_Pr, map_Pm, map_ao),
 * sonst aus Glanz (Ns) und Glanzfarbe (Ks). Halbtransparente Materialien ohne Bild werden zu Glas.
 */
export function toPbr(source: Material, info: MtlInfo | undefined, loadMap: (path: string) => Texture): Material {
  // OBJ und 3DS liefern Phong-, Collada auch Lambert-Materialien; glTF ist schon physikalisch basiert
  if (!(source instanceof MeshPhongMaterial || source instanceof MeshLambertMaterial)) return source
  const shininess = source instanceof MeshPhongMaterial ? source.shininess : 0
  const specularColor = source instanceof MeshPhongMaterial ? source.specular : null
  const number = (key: string) => {
    const value = info?.[key]
    const n = typeof value === 'string' ? Number.parseFloat(value) : NaN
    return Number.isFinite(n) ? n : null
  }
  const map = (key: string) => {
    const value = info?.[key]
    if (typeof value !== 'string') return null
    // Optionen wie „-bm 1“ vor dem Dateinamen überspringen
    const path = value.trim().split(/\s+/).pop()
    if (!path) return null
    const texture = loadMap(path)
    texture.colorSpace = NoColorSpace
    texture.anisotropy = MAX_ANISOTROPY
    return texture
  }
  const specular = specularColor ? Math.max(specularColor.r, specularColor.g, specularColor.b) : 0
  // Näherung des Blinn-Phong-Exponenten durch die Rauheit des GGX-Modells
  let roughness = Math.min(1, Math.max(0.08, Math.sqrt(2 / (shininess + 2))))
  if (specular < 0.05) roughness = Math.max(roughness, 0.75)
  roughness = number('pr') ?? roughness
  const metalness = number('pm') ?? 0
  const glass = source.transparent && source.opacity < 1 && !source.map
  const parameters = {
    name: source.name,
    color: source.color,
    map: source.map,
    normalMap: source instanceof MeshPhongMaterial ? source.normalMap : null,
    bumpMap: source instanceof MeshPhongMaterial ? source.bumpMap : null,
    bumpScale: source instanceof MeshPhongMaterial ? source.bumpScale : 1,
    alphaMap: source.alphaMap,
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    opacity: source.opacity,
    transparent: source.transparent,
    // Viele Katalogmodelle sind nicht geschlossen: beide Seiten zeichnen
    side: DoubleSide,
    roughness,
    metalness,
    roughnessMap: map('map_pr'),
    metalnessMap: map('map_pm'),
    aoMap: map('map_ao'),
    // Blätter usw. (Erweiterung von build-packs.mjs): durchsichtige Teile des Bilds abschneiden
    alphaTest: number('alphatest') ?? 0,
  }
  for (const texture of [parameters.map, parameters.normalMap, parameters.bumpMap, parameters.alphaMap, parameters.emissiveMap]) {
    if (texture) texture.anisotropy = MAX_ANISOTROPY
  }
  const result = glass
    ? new MeshPhysicalMaterial({ ...parameters, roughness: Math.min(roughness, 0.05), metalness: 0, ior: 1.5, envMapIntensity: 1.5, depthWrite: false })
    : new MeshStandardMaterial(parameters)
  // Im Foto-Modus wird Glas lichtbrechend (siehe PhotoDialog)
  if (glass) result.userData.glass = true
  // Ohne Glanzfarbe nicht zusätzlich spiegeln (z. B. Stoffe in alten Modellen)
  if (!glass && specular < 0.05 && number('pr') === null) result.envMapIntensity = 0.7
  return result
}
