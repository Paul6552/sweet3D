import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  type Material,
  Mesh,
  type MeshPhysicalMaterial,
  ObjectLoader,
  type PixelFormat,
  PointLight,
  Quaternion,
  Scene,
  TextureSource,
  type Texture,
  type TextureDataType,
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import type { IndoorUniforms, PhotoSnapshot } from './photoRender'

/**
 * A {@link PhotoSnapshot} as plain data, so a queued photo survives a browser restart. The snapshot
 * shares geometries and materials with the live 3D view, which no longer exists after a restart;
 * the stored form is self-contained. Bulk data (geometry buffers, images) lives in separate assets
 * addressed by the hash of their content, so several photos of one scene store it only once.
 */

const ARRAY_TYPES = { Float32Array, Float64Array, Uint32Array, Int32Array, Uint16Array, Int16Array, Uint8Array, Int8Array }
type ArrayKind = keyof typeof ARRAY_TYPES
type NumericArray = InstanceType<(typeof ARRAY_TYPES)[ArrayKind]>

/** A typed array inside the asset of a geometry. */
interface StoredArray {
  kind: ArrayKind
  /** Position in the asset, in bytes. */
  offset: number
  bytes: number
}

interface StoredAttribute extends StoredArray {
  name: string
  itemSize: number
  normalized: boolean
}

interface StoredGeometry {
  /** Index into {@link StoredSnapshot.assets}. */
  asset: number
  attributes: StoredAttribute[]
  index: StoredArray | null
  groups: { start: number; count: number; materialIndex?: number }[]
}

/** Pixel data of a data texture; encoded images (PNG) do not need this. */
interface StoredRawImage {
  kind: ArrayKind
  width: number
  height: number
}

interface StoredImage {
  /** Id of the texture source, referenced by the texture JSON. */
  uuid: string
  /** Index into {@link StoredSnapshot.assets}; null for a texture without an image. */
  asset: number | null
  raw: StoredRawImage | null
}

interface StoredMaterial {
  /** Output of Material.toJSON. */
  json: { uuid: string }
  /** Exact color values; the JSON only keeps 8 bits per channel. */
  colors: Record<string, number[]>
  /** Invisible to the camera, see hideMatteFromCamera. */
  matte: boolean
}

type StoredLight =
  | { type: 'directional'; color: number[]; intensity: number; position: number[]; target: number[] }
  | { type: 'point'; color: number[]; intensity: number; distance: number; decay: number; position: number[] }

interface StoredDataTexture extends StoredRawImage {
  asset: number
  format: number
  type: number
  magFilter: number
  minFilter: number
}

interface StoredIndoor {
  map: StoredDataTexture
  rooms: StoredDataTexture
  grid: number[]
  size: number[]
  levels: number[][]
  count: number
  enabled: number
  adapt: number
}

export interface StoredSnapshot {
  /** Content hashes of the assets; empty strings until {@link storeAssets} has written them. */
  assets: string[]
  geometries: StoredGeometry[]
  images: StoredImage[]
  /** Output of Texture.toJSON. */
  textures: unknown[]
  materials: StoredMaterial[]
  meshes: { geometry: number; material: number; matrix: number[] }[]
  lights: StoredLight[]
  sunDirection: number[]
  environmentIntensity: number
  camera: { position: number[]; quaternion: number[]; fov: number; near: number; far: number }
  exposure: number
  indoor: StoredIndoor | null
}

/** Bulk data of a snapshot that is not read until it is written. */
interface AssetSource {
  /** Stays the same for the same data, so unchanged data is not encoded again for the next photo. */
  key: object
  read: () => Blob | Promise<Blob>
}

export interface CapturedSnapshot {
  manifest: StoredSnapshot
  sources: AssetSource[]
}

/** Where assets are kept, see renderStore. */
export interface AssetStore {
  keys: () => Promise<string[]>
  putAll: (assets: [hash: string, blob: Blob][]) => Promise<void>
}

function arrayKind(array: ArrayBufferView): ArrayKind {
  const kind = array.constructor.name
  if (kind in ARRAY_TYPES) return kind as ArrayKind
  throw new Error(`Unsupported array type ${kind}`)
}

/** Values of an attribute without the other attributes it may be interleaved with. */
function attributeValues(attribute: BufferGeometry['attributes'][string]): NumericArray {
  if (attribute instanceof BufferAttribute) return attribute.array as NumericArray
  const source = attribute.data.array as NumericArray
  const values = new ARRAY_TYPES[arrayKind(source)](attribute.count * attribute.itemSize)
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(i, c)
  }
  return values
}

/** All textures a material refers to. */
function materialTextures(material: Material): Texture[] {
  return Object.values(material).filter((value) => (value as Texture | null)?.isTexture) as Texture[]
}

/** Image of a texture as PNG; decoded again by {@link loadImage}. */
function encodeImage(image: CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number }): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth ?? image.width
  canvas.height = image.naturalHeight ?? image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas available')
  context.drawImage(image, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image could not be encoded'))), 'image/png'))
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Describes a snapshot as plain data. Everything small is read right away, the bulk data only in
 * {@link storeAssets}: the model is locked while jobs are pending, so it stays the same until then.
 */
export function captureSnapshot(snapshot: PhotoSnapshot): CapturedSnapshot {
  const sources: AssetSource[] = []
  const addAsset = (source: AssetSource) => sources.push(source) - 1

  const geometries: StoredGeometry[] = []
  const geometryIndex = new Map<BufferGeometry, number>()
  const addGeometry = (geometry: BufferGeometry) => {
    let result = geometryIndex.get(geometry)
    if (result !== undefined) return result
    const parts: NumericArray[] = []
    let offset = 0
    const addArray = (array: NumericArray): StoredArray => {
      const stored = { kind: arrayKind(array), offset, bytes: array.byteLength }
      parts.push(array)
      offset += array.byteLength
      return stored
    }
    const attributes = Object.entries(geometry.attributes).map(
      ([name, attribute]): StoredAttribute => ({
        ...addArray(attributeValues(attribute)),
        name,
        itemSize: attribute.itemSize,
        normalized: attribute.normalized,
      }),
    )
    const index = geometry.index ? addArray(geometry.index.array as NumericArray) : null
    const asset = addAsset({ key: geometry, read: () => new Blob(parts as BlobPart[]) })
    result = geometries.push({ asset, attributes, index, groups: geometry.groups.map((g) => ({ ...g })) }) - 1
    geometryIndex.set(geometry, result)
    return result
  }

  const images: StoredImage[] = []
  const bitmaps = new Set<string>()
  const addImage = (source: TextureSource<unknown>) => {
    const image = source.data as (CanvasImageSource & { data?: NumericArray; width: number; height: number }) | null
    if (!image) {
      images.push({ uuid: source.uuid, asset: null, raw: null })
    } else if (image.data) {
      const data = image.data
      const asset = addAsset({ key: data, read: () => new Blob([data as BlobPart]) })
      images.push({ uuid: source.uuid, asset, raw: { kind: arrayKind(data), width: image.width, height: image.height } })
    } else {
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) bitmaps.add(source.uuid)
      images.push({ uuid: source.uuid, asset: addAsset({ key: image, read: () => encodeImage(image) }), raw: null })
    }
  }

  // Filled in advance, otherwise Texture.toJSON encodes every image as a data URL
  const meta = { textures: {} as Record<string, { image: string; flipY: boolean }>, images: {} as Record<string, unknown> }
  const materials: StoredMaterial[] = []
  const materialIndex = new Map<Material, number>()
  const addMaterial = (material: Material) => {
    let result = materialIndex.get(material)
    if (result !== undefined) return result
    for (const { source } of materialTextures(material)) {
      if (meta.images[source.uuid]) continue
      meta.images[source.uuid] = { uuid: source.uuid }
      addImage(source)
    }
    const colors: Record<string, number[]> = {}
    for (const [name, value] of Object.entries(material)) {
      if ((value as Color | null)?.isColor) colors[name] = (value as Color).toArray()
    }
    const json = (material as unknown as { toJSON: (data: unknown) => StoredMaterial['json'] }).toJSON(meta)
    result = materials.push({ json, colors, matte: Boolean((material as { matte?: boolean }).matte) }) - 1
    materialIndex.set(material, result)
    return result
  }

  const meshes: StoredSnapshot['meshes'] = []
  const lights: StoredLight[] = []
  snapshot.scene.traverse((object) => {
    if (object instanceof Mesh) {
      meshes.push({ geometry: addGeometry(object.geometry), material: addMaterial(object.material as Material), matrix: object.matrix.toArray() })
    } else if (object instanceof DirectionalLight) {
      lights.push({
        type: 'directional',
        color: object.color.toArray(),
        intensity: object.intensity,
        position: object.position.toArray(),
        target: object.target.position.toArray(),
      })
    } else if (object instanceof PointLight) {
      lights.push({
        type: 'point',
        color: object.color.toArray(),
        intensity: object.intensity,
        distance: object.distance,
        decay: object.decay,
        position: object.position.toArray(),
      })
    }
  })

  const textures = Object.values(meta.textures)
  // WebGL does not flip image bitmaps whatever the texture says, but it would flip the decoded PNG
  for (const texture of textures) if (bitmaps.has(texture.image)) texture.flipY = false

  const addDataTexture = (texture: DataTexture): StoredDataTexture => {
    const { data, width, height } = texture.image
    const array = data as NumericArray
    return {
      asset: addAsset({ key: array, read: () => new Blob([array as BlobPart]) }),
      kind: arrayKind(array),
      width,
      height,
      format: texture.format,
      type: texture.type,
      magFilter: texture.magFilter,
      minFilter: texture.minFilter,
    }
  }
  const { indoor, camera } = snapshot
  return {
    sources,
    manifest: {
      assets: sources.map(() => ''),
      geometries,
      images,
      textures,
      materials,
      meshes,
      lights,
      sunDirection: snapshot.sunDirection.toArray(),
      environmentIntensity: snapshot.environmentIntensity,
      camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, near: camera.near, far: camera.far },
      exposure: snapshot.exposure,
      indoor: indoor && {
        map: addDataTexture(indoor.indoorMap.value),
        rooms: addDataTexture(indoor.indoorRooms.value),
        grid: indoor.indoorGrid.value.toArray(),
        size: indoor.indoorSize.value.toArray(),
        levels: indoor.indoorLevels.value.map((v) => v.toArray()),
        count: indoor.indoorCount.value,
        enabled: indoor.indoorEnabled.value,
        adapt: indoor.indoorAdapt.value,
      },
    },
  }
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Hash of already stored data; spares the next photo of the same scene from encoding it again. */
const knownHashes = new WeakMap<object, string>()
/** Assets per write. Limits the memory in use, while a scene can have thousands of small assets. */
const ASSET_BATCH = 64

/**
 * Writes the bulk data of a snapshot and completes its manifest with the content hashes. Works in
 * batches: while a photo is rendering, every single wait can take a whole animation frame.
 */
export async function storeAssets({ manifest, sources }: CapturedSnapshot, store: AssetStore) {
  const stored = new Set(await store.keys())
  for (let start = 0; start < sources.length; start += ASSET_BATCH) {
    const batch = new Map<string, Blob>()
    await Promise.all(
      sources.slice(start, start + ASSET_BATCH).map(async (source, i) => {
        let hash = knownHashes.get(source.key)
        if (!hash || !stored.has(hash)) {
          const blob = await source.read()
          hash = await sha256(blob)
          if (!stored.has(hash)) batch.set(hash, blob)
          knownHashes.set(source.key, hash)
        }
        manifest.assets[start + i] = hash
      }),
    )
    await store.putAll([...batch])
    for (const hash of batch.keys()) stored.add(hash)
  }
}

/** Rebuilds a snapshot from its stored form; unlike the original it shares nothing with the 3D view. */
export async function restoreSnapshot(manifest: StoredSnapshot, loadAsset: (hash: string) => Promise<Blob | undefined>): Promise<PhotoSnapshot> {
  const asset = async (index: number) => {
    const blob = await loadAsset(manifest.assets[index])
    if (!blob) throw new Error(`Asset ${manifest.assets[index]} is missing`)
    return blob
  }
  const typedArray = (kind: ArrayKind, buffer: ArrayBuffer) => new ARRAY_TYPES[kind](buffer)

  const geometries: BufferGeometry[] = []
  for (const stored of manifest.geometries) {
    const buffer = await (await asset(stored.asset)).arrayBuffer()
    const read = ({ kind, offset, bytes }: StoredArray) => typedArray(kind, buffer.slice(offset, offset + bytes))
    const geometry = new BufferGeometry()
    for (const attribute of stored.attributes) {
      geometry.setAttribute(attribute.name, new BufferAttribute(read(attribute), attribute.itemSize, attribute.normalized))
    }
    if (stored.index) geometry.setIndex(new BufferAttribute(read(stored.index), 1))
    for (const { start, count, materialIndex } of stored.groups) geometry.addGroup(start, count, materialIndex)
    geometries.push(geometry)
  }

  const sources: Record<string, TextureSource<unknown>> = {}
  for (const { uuid, asset: index, raw } of manifest.images) {
    let image: unknown = null
    if (index !== null) {
      const blob = await asset(index)
      image = raw ? { data: typedArray(raw.kind, await blob.arrayBuffer()), width: raw.width, height: raw.height } : await loadImage(blob)
    }
    const source = new TextureSource(image)
    source.uuid = uuid
    sources[uuid] = source
  }
  const loader = new ObjectLoader()
  const textures = loader.parseTextures(manifest.textures, sources)
  // The path tracer reads the transform directly; otherwise only the renderer updates it
  Object.values(textures).forEach((texture) => texture.updateMatrix())
  const parsed = loader.parseMaterials(
    manifest.materials.map((m) => m.json),
    textures,
  )
  const materials = manifest.materials.map(({ json, colors, matte }) => {
    const material = parsed[json.uuid]
    for (const [name, value] of Object.entries(colors)) (material as unknown as Record<string, Color>)[name]?.fromArray(value)
    if (matte) Object.assign(material, { matte })
    return material as MeshPhysicalMaterial
  })

  const scene = new Scene()
  for (const { geometry, material, matrix } of manifest.meshes) {
    const mesh = new Mesh(geometries[geometry], materials[material])
    mesh.matrixAutoUpdate = false
    mesh.matrix.fromArray(matrix)
    scene.add(mesh)
  }
  for (const stored of manifest.lights) {
    const color = new Color().fromArray(stored.color)
    if (stored.type === 'directional') {
      const light = new DirectionalLight(color, stored.intensity)
      light.position.fromArray(stored.position)
      light.target.position.fromArray(stored.target)
      scene.add(light, light.target)
    } else {
      const light = new PointLight(color, stored.intensity, stored.distance, stored.decay)
      light.position.fromArray(stored.position)
      scene.add(light)
    }
  }

  const readDataTexture = async (stored: StoredDataTexture) => {
    const data = typedArray(stored.kind, await (await asset(stored.asset)).arrayBuffer())
    const texture = new DataTexture(data, stored.width, stored.height, stored.format as PixelFormat, stored.type as TextureDataType)
    texture.magFilter = stored.magFilter as MagnificationTextureFilter
    texture.minFilter = stored.minFilter as MinificationTextureFilter
    texture.needsUpdate = true
    return texture
  }
  const stored = manifest.indoor
  const indoor: IndoorUniforms | null = stored && {
    indoorMap: { value: await readDataTexture(stored.map) },
    indoorRooms: { value: await readDataTexture(stored.rooms) },
    indoorGrid: { value: new Vector4().fromArray(stored.grid) },
    indoorSize: { value: new Vector2().fromArray(stored.size) },
    indoorLevels: { value: stored.levels.map((v) => new Vector2().fromArray(v)) },
    indoorCount: { value: stored.count },
    indoorEnabled: { value: stored.enabled },
    indoorAdapt: { value: stored.adapt },
  }

  const { camera } = manifest
  return {
    scene,
    sunDirection: new Vector3().fromArray(manifest.sunDirection),
    environmentIntensity: manifest.environmentIntensity,
    camera: {
      position: new Vector3().fromArray(camera.position),
      quaternion: new Quaternion().fromArray(camera.quaternion),
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
    },
    exposure: manifest.exposure,
    indoor,
    dispose: () => {
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      Object.values(textures).forEach((t) => t.dispose())
      indoor?.indoorMap.value.dispose()
      indoor?.indoorRooms.value.dispose()
    },
  }
}
