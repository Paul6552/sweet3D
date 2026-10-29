import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LoadingManager,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  TextureLoader,
  Vector3,
  type Object3D,
} from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KMZLoader } from 'three/examples/jsm/loaders/KMZLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CONTENT_PREFIX, contentKey, isContentRef } from '../model/contents'
import { contentUrl, contentUrlsWithPrefix } from '../storage/contents'
import { type MtlInfo, toPbr } from './materials'
import { patchIndoorLight } from './indoorLight'

type MaterialCreator = ReturnType<MTLLoader['parse']>

let defaultMaterials: Promise<MaterialCreator> | null = null
const models = new Map<string, Promise<Group>>()

/** Standard-Materialien der Katalogmodelle (z. B. „white“), siehe scripts/build-catalog.mjs. */
function loadDefaultMaterials(): Promise<MaterialCreator> {
  defaultMaterials ??= fetch('/catalog/default-materials.mtl')
    .then((r) => r.text())
    .then((text) => {
      const creator = new MTLLoader().parse(text, '')
      creator.preload()
      return creator
    })
  return defaultMaterials
}

export type ModelFormat = 'obj' | 'gltf' | 'glb' | 'dae' | '3ds' | 'kmz'

/**
 * Format eines Modells nach Dateiendung, sonst nach den ersten Bytes (importierte einteilige
 * Modelle haben Schlüssel ohne Dateinamen). Sweet Home 3D kennt OBJ, DAE, 3DS und KMZ.
 */
export function modelFormat(ref: string, bytes: Uint8Array): ModelFormat {
  const extension = /\.([a-z0-9]+)$/i.exec(ref)?.[1]?.toLowerCase()
  if (extension === 'gltf' || extension === 'glb' || extension === 'dae' || extension === '3ds' || extension === 'kmz') return extension
  if (extension === 'obj') return 'obj'
  const head = new TextDecoder().decode(bytes.subarray(0, 256))
  if (head.startsWith('glTF')) return 'glb'
  if (bytes[0] === 0x4d && bytes[1] === 0x4d) return '3ds'
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'kmz'
  if (/<COLLADA/i.test(head)) return 'dae'
  if (/^\s*\{/.test(head) && head.includes('"asset"')) return 'gltf'
  return 'obj'
}

/**
 * Lädt ein Modell samt Materialien einmal pro Fenster und liefert es ungeändert, mit
 * physikalisch basierten Materialien (siehe toPbr). {@code ref} ist eine Katalog-URL oder ein
 * Verweis auf importierten Inhalt; dessen Schlüssel sind eindeutig, daher taugt der Verweis auch
 * als Cache-Schlüssel.
 */
function loadModel(ref: string): Promise<Group> {
  let model = models.get(ref)
  if (!model) {
    model = (async () => {
      const resolve = await resolverFor(ref)
      const base = ref.substring(0, ref.lastIndexOf('/') + 1)
      // Texturen und MTL-Dateien relativ zum Modell, bei importierten Modellen aus den Inhalten
      const manager = new LoadingManager()
      manager.setURLModifier(resolve)
      const response = await fetch(resolve(ref))
      if (!response.ok) throw new Error(`${ref}: HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const format = modelFormat(ref, bytes)
      const object = await parseModel(format, bytes, base, manager)
      const converted = new Map<Material, Material>()
      object.traverse((child) => {
        if (!(child instanceof Mesh)) return
        const info = (child.userData.mtl ?? {}) as Record<string, MtlInfo>
        const convert = (m: Material) => {
          let result = converted.get(m)
          if (!result) {
            result = patchIndoorLight(toPbr(m, info[m.name], (path) => new TextureLoader(manager).load(base + path)))
            result.side = DoubleSide
            converted.set(m, result)
          }
          return result
        }
        if (!child.material) child.material = patchIndoorLight(new MeshStandardMaterial({ color: 0xcccccc, side: DoubleSide }))
        else child.material = Array.isArray(child.material) ? child.material.map(convert) : convert(child.material)
        delete child.userData.mtl
        child.castShadow = castsShadow(child.material)
        child.receiveShadow = true
      })
      return mergeByMaterial(object)
    })()
    // Fehlgeschlagene Ladevorgänge nicht merken, damit z. B. ein später importierter Katalog greift
    model.catch(() => models.delete(ref))
    models.set(ref, model)
  }
  return model
}

/** Glas wirft keinen Schatten, sonst fiele keine Sonne durch die Fenster (die Schattenkarte kennt keine Transparenz). */
function castsShadow(material: Material | Material[]): boolean {
  return (Array.isArray(material) ? material : [material]).some((m) => !m.transparent || m.opacity >= 0.9)
}

/**
 * Fasst alle Teile eines Modells mit gleichem Material zu einem Mesh zusammen. Katalogmodelle
 * bestehen oft aus Dutzenden kleiner Teile, und jedes kostet je Bild einen Zeichenaufruf (mit
 * Schatten zwei). Bei größeren Projekten lastet das schwächere Grafikkarten so aus, dass beim
 * Bewegen der 3D-Ansicht die ganze Seite flackert.
 */
function mergeByMaterial(object: Group): Group {
  object.updateMatrixWorld(true)
  const toModel = object.matrixWorld.clone().invert()
  const parts = new Map<string, { material: Material; geometries: BufferGeometry[]; sources: Mesh[] }>()
  object.traverse((child) => {
    // Animierte Modelle unverändert lassen
    if (!(child instanceof Mesh) || child instanceof SkinnedMesh || child instanceof InstancedMesh) return
    if (Object.keys(child.geometry.morphAttributes).length > 0) return
    const matrix = toModel.clone().multiply(child.matrixWorld)
    const materials: Material[] = Array.isArray(child.material) ? child.material : [child.material]
    const geometry = flatGeometry(child.geometry)
    const groups = Array.isArray(child.material) && geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }]
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0]
      if (!material) continue
      const part = sliceGeometry(geometry, group.start, group.count)
      if (!part) continue
      part.applyMatrix4(matrix)
      // Gespiegelte Teile zeichnet three.js sonst mit umgekehrter Vorderseite (falsch beleuchtet)
      if (matrix.determinant() < 0) reverseWinding(part)
      // Nur Teile mit gleichen Attributen lassen sich zusammenfügen
      const attributes = Object.entries(part.attributes)
        .map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`)
        .sort()
      const key = `${material.uuid}|${attributes.join(',')}`
      let entry = parts.get(key)
      if (!entry) parts.set(key, (entry = { material, geometries: [], sources: [] }))
      entry.geometries.push(part)
      if (!entry.sources.includes(child)) entry.sources.push(child)
    }
  })
  const merged: Mesh[] = []
  for (const { material, geometries } of parts.values()) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries)
    // Lässt sich etwas nicht zusammenfügen, bleibt das Modell, wie es ist
    if (!geometry) return object
    const mesh = new Mesh(geometry, material)
    mesh.castShadow = castsShadow(material)
    mesh.receiveShadow = true
    merged.push(mesh)
  }
  for (const { sources } of parts.values()) for (const source of sources) source.removeFromParent()
  if (merged.length > 0) object.add(...merged)
  return object
}

/** Geometrie ohne Index und ohne verschachtelte Attribute, damit sich Teile beliebig zusammenfügen lassen. */
function flatGeometry(source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry()
  const index = source.index
  const count = index ? index.count : (source.getAttribute('position')?.count ?? 0)
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const size = attribute.itemSize
    const ArrayType = attribute.array.constructor as new (length: number) => typeof attribute.array
    const array = new ArrayType(count * size)
    for (let i = 0; i < count; i++) {
      const from = index ? index.getX(i) : i
      for (let c = 0; c < size; c++) array[i * size + c] = attribute.getComponent(from, c)
    }
    geometry.setAttribute(name, new BufferAttribute(array, size, attribute.normalized))
  }
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex)
  return geometry
}

/** Ausschnitt [start, start + count) einer Geometrie ohne Index. */
function sliceGeometry(geometry: BufferGeometry, start: number, count: number): BufferGeometry | null {
  const total = geometry.getAttribute('position')?.count ?? 0
  const end = Math.min(total, start + count)
  if (end <= start) return null
  if (start === 0 && end === total) return geometry.clone()
  const part = new BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const size = attribute.itemSize
    part.setAttribute(name, new BufferAttribute(attribute.array.slice(start * size, end * size), size, attribute.normalized))
  }
  return part
}

/** Vertauscht in jedem Dreieck die letzten beiden Ecken. */
function reverseWinding(geometry: BufferGeometry) {
  for (const attribute of Object.values(geometry.attributes)) {
    const { array, itemSize } = attribute
    for (let t = 0; t + 2 < attribute.count; t += 3) {
      for (let c = 0; c < itemSize; c++) {
        const a = (t + 1) * itemSize + c
        const b = (t + 2) * itemSize + c
        ;[array[a], array[b]] = [array[b], array[a]]
      }
    }
  }
}

async function parseModel(format: ModelFormat, bytes: Uint8Array, base: string, manager: LoadingManager): Promise<Group> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  switch (format) {
    case 'gltf':
    case 'glb': {
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, base)
      const group = new Group()
      group.add(gltf.scene)
      return group
    }
    case 'dae': {
      const collada = new ColladaLoader(manager).parse(new TextDecoder().decode(bytes), base)
      if (!collada) throw new Error('Ungültige Collada-Datei')
      const group = new Group()
      group.add(collada.scene)
      return group
    }
    case 'kmz': {
      const group = new Group()
      group.add(new KMZLoader(manager).parse(buffer).scene)
      return group
    }
    case '3ds':
      return new TDSLoader(manager).setResourcePath(base).parse(buffer, base)
    case 'obj':
      return parseObj(new TextDecoder().decode(bytes), base, manager)
  }
}

/** OBJ mit eigener MTL-Datei (mtllib), sonst mit den Standard-Materialien von Sweet Home 3D. */
async function parseObj(text: string, base: string, manager: LoadingManager): Promise<Group> {
  const defaults = await loadDefaultMaterials()
  const library = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim()
  let own: MaterialCreator | null = null
  if (library) {
    const loader = new MTLLoader(manager).setPath(base).setResourcePath(base)
    own = await loader.loadAsync(library).catch(() => null)
    own?.preload()
  }
  const materials = {
    create: (name: string) => own?.materials[name] ?? own?.create(name) ?? defaults.create(name),
    preload: () => {},
  } as unknown as MaterialCreator
  const object = new OBJLoader().setMaterials(materials).parse(text)
  // PBR-Erweiterungen der MTL-Datei für toPbr merken
  const info = (own?.materialsInfo ?? {}) as Record<string, MtlInfo>
  object.traverse((child) => {
    if (child instanceof Mesh) child.userData.mtl = info
  })
  return object
}

/**
 * Bildet Verweise auf importierte Inhalte auf Object-URLs ab. Bei mehrteiligen Modellen werden
 * alle Dateien vorab aufgelöst, da der LoadingManager die URLs synchron umschreibt.
 */
async function resolverFor(ref: string): Promise<(url: string) => string> {
  if (!isContentRef(ref)) return (url) => url
  const key = contentKey(ref)
  const slash = key.indexOf('/')
  const urls = new Map<string, string>()
  if (slash < 0) {
    const url = await contentUrl(key)
    if (url) urls.set(ref, url)
  } else {
    for (const [k, url] of await contentUrlsWithPrefix(key.slice(0, slash + 1))) urls.set(CONTENT_PREFIX + k, url)
  }
  if (!urls.has(ref)) throw new Error(`Inhalt ${ref} fehlt`)
  return (url) => urls.get(url) ?? url
}

/**
 * Größe eines Modells in seinen eigenen Einheiten; glTF ist immer in Metern, andere Formate meist
 * in cm (siehe catalog/libraries.ts).
 */
export async function measureModel(ref: string): Promise<{ width: number; height: number; depth: number; meters: boolean }> {
  const size = new Box3().setFromObject(await loadModel(ref)).getSize(new Vector3())
  return { width: size.x, height: size.y, depth: size.z, meters: /\.(gltf|glb)$/i.test(ref) }
}

/**
 * Modell für ein Möbel wie in Sweet Home 3D (ModelManager): Modellrotation anwenden, dann so
 * skalieren, dass es genau width × height × depth einnimmt, unten mittig am Ursprung.
 */
export async function loadNormalizedModel(
  ref: string,
  modelRotation: number[][] | null,
  size: { width: number; height: number; depth: number },
): Promise<Object3D> {
  const source = await loadModel(ref)
  const rotated = new Group()
  const clone = source.clone(true)
  if (modelRotation) {
    const [[a, b, c], [d, e, f], [g, h, i]] = modelRotation
    clone.applyMatrix4(new Matrix4().set(a, b, c, 0, d, e, f, 0, g, h, i, 0, 0, 0, 0, 1))
  }
  rotated.add(clone)
  const box = new Box3().setFromObject(rotated)
  const extent = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  const scale = new Vector3(size.width / (extent.x || 1), size.height / (extent.y || 1), size.depth / (extent.z || 1))
  const normalized = new Group()
  rotated.scale.copy(scale)
  rotated.position.set(-center.x * scale.x, -box.min.y * scale.y, -center.z * scale.z)
  normalized.add(rotated)
  return normalized
}
