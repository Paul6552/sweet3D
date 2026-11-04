import { BoxGeometry, Color, DataTexture, DirectionalLight, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PointLight, Quaternion, RepeatWrapping, RGBAFormat, Scene, UnsignedByteType, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { unusedAssets } from '../storage/renderStore'
import { type AssetStore, captureSnapshot, restoreSnapshot, type StoredSnapshot, storeAssets } from './photoPersist'
import type { PhotoSnapshot } from './photoRender'

function snapshotOf(scene: Scene): PhotoSnapshot {
  return {
    scene,
    sunDirection: new Vector3(0, 1, 0),
    environmentIntensity: 0.8,
    camera: { position: new Vector3(1, 2, 3), quaternion: new Quaternion(0, 0.6, 0, 0.8), fov: 50, near: 1, far: 100 },
    exposure: 1.5,
    indoor: null,
    dispose: () => {},
  }
}

function memoryStore() {
  const blobs = new Map<string, Blob>()
  const store: AssetStore = {
    keys: () => Promise.resolve([...blobs.keys()]),
    putAll: (assets) => {
      assets.forEach(([hash, blob]) => blobs.set(hash, blob))
      return Promise.resolve()
    },
  }
  return { blobs, store }
}

async function roundTrip(snapshot: PhotoSnapshot): Promise<PhotoSnapshot> {
  const { blobs, store } = memoryStore()
  const captured = captureSnapshot(snapshot)
  await storeAssets(captured, store)
  // As in IndexedDB: only plain data survives
  return restoreSnapshot(structuredClone(captured.manifest), (hash) => Promise.resolve(blobs.get(hash)))
}

function meshes(scene: Scene): Mesh[] {
  return scene.children.filter((child) => child instanceof Mesh)
}

describe('photoPersist', () => {
  it('stellt Geometrie, Position und Gruppen wieder her', async () => {
    const scene = new Scene()
    const geometry = new BoxGeometry(2, 3, 4)
    const mesh = new Mesh(geometry, new MeshStandardMaterial())
    mesh.matrixAutoUpdate = false
    mesh.matrix.makeTranslation(10, 20, 30)
    scene.add(mesh)

    const [restored] = meshes((await roundTrip(snapshotOf(scene))).scene)
    expect(restored.matrixAutoUpdate).toBe(false)
    expect(restored.matrix.toArray()).toEqual(mesh.matrix.toArray())
    expect(Array.from(restored.geometry.getAttribute('position').array)).toEqual(Array.from(geometry.getAttribute('position').array))
    expect(Array.from(restored.geometry.getAttribute('uv').array)).toEqual(Array.from(geometry.getAttribute('uv').array))
    expect(Array.from(restored.geometry.index!.array)).toEqual(Array.from(geometry.index!.array))
    expect(restored.geometry.groups).toEqual(geometry.groups)
  })

  it('behält exakte Farben und die Eigenschaften von Glas', async () => {
    const scene = new Scene()
    const color = new Color(0.123456, 0.654321, 0.333333)
    const material = new MeshPhysicalMaterial({ color, transmission: 1, thickness: 0, roughness: 0, ior: 1.3 })
    scene.add(new Mesh(new BoxGeometry(), material))

    const restored = meshes((await roundTrip(snapshotOf(scene))).scene)[0].material as MeshPhysicalMaterial
    expect(restored).toBeInstanceOf(MeshPhysicalMaterial)
    expect(restored.color.toArray()).toEqual(color.toArray())
    expect(restored.transmission).toBe(1)
    expect(restored.ior).toBeCloseTo(1.3)
  })

  it('behält die Markierung für Flächen, die die Kamera nicht sieht', async () => {
    const scene = new Scene()
    const hidden = new MeshStandardMaterial()
    Object.assign(hidden, { matte: true })
    scene.add(new Mesh(new BoxGeometry(), hidden), new Mesh(new BoxGeometry(), new MeshStandardMaterial()))

    const [first, second] = meshes((await roundTrip(snapshotOf(scene))).scene)
    expect((first.material as unknown as { matte?: boolean }).matte).toBe(true)
    expect((second.material as unknown as { matte?: boolean }).matte).toBeUndefined()
  })

  it('stellt Texturen samt Wiederholung wieder her und berechnet ihre Matrix', async () => {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 255])
    const texture = new DataTexture(pixels, 2, 2, RGBAFormat, UnsignedByteType)
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.set(4, 2)
    const scene = new Scene()
    scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture })))

    const { map } = meshes((await roundTrip(snapshotOf(scene))).scene)[0].material as MeshStandardMaterial
    expect(Array.from((map!.image as { data: Uint8Array }).data)).toEqual(Array.from(pixels))
    expect(map!.wrapS).toBe(RepeatWrapping)
    expect(map!.repeat.toArray()).toEqual([4, 2])
    // Scale of the texture transform, which the path tracer reads without the renderer updating it
    expect(map!.matrix.elements[0]).toBe(4)
  })

  it('stellt Lichter, Sonne und Kamera wieder her', async () => {
    const scene = new Scene()
    const sun = new DirectionalLight(new Color(1, 0.9, 0.8), 3)
    sun.position.set(100, 200, 300)
    sun.target.position.set(1, 2, 3)
    const lamp = new PointLight(new Color(0.5, 0.5, 1), 7, 400, 2)
    lamp.position.set(4, 5, 6)
    scene.add(sun, sun.target, lamp)

    const restored = await roundTrip(snapshotOf(scene))
    const lights = restored.scene.children
    const restoredSun = lights.find((l) => l instanceof DirectionalLight)!
    const restoredLamp = lights.find((l) => l instanceof PointLight)!
    expect(restoredSun.intensity).toBe(3)
    expect(restoredSun.position.toArray()).toEqual([100, 200, 300])
    expect(restoredSun.target.position.toArray()).toEqual([1, 2, 3])
    expect(restoredSun.target.parent).toBe(restored.scene)
    expect(restoredLamp.distance).toBe(400)
    expect(restoredLamp.decay).toBe(2)
    expect(restored.camera.position.toArray()).toEqual([1, 2, 3])
    expect(restored.camera.fov).toBe(50)
    expect(restored.exposure).toBe(1.5)
    expect(restored.environmentIntensity).toBe(0.8)
  })

  it('schlägt fehl, wenn gespeicherte Daten fehlen', async () => {
    const scene = new Scene()
    scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()))
    const captured = captureSnapshot(snapshotOf(scene))
    await storeAssets(captured, memoryStore().store)
    await expect(restoreSnapshot(captured.manifest, () => Promise.resolve(undefined))).rejects.toThrow('missing')
  })

  it('speichert gleiche Inhalte nur einmal', async () => {
    const scene = new Scene()
    scene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()), new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()))
    const { blobs, store } = memoryStore()
    const first = captureSnapshot(snapshotOf(scene))
    const second = captureSnapshot(snapshotOf(scene))
    await storeAssets(first, store)
    await storeAssets(second, store)
    expect(blobs.size).toBe(1)
    expect(second.manifest.assets).toEqual(first.manifest.assets)
  })

  it('verarbeitet mehr Daten als in einen Schreibvorgang passen', async () => {
    const scene = new Scene()
    for (let i = 1; i <= 150; i++) scene.add(new Mesh(new BoxGeometry(i, 1, 1), new MeshStandardMaterial()))
    const restored = meshes((await roundTrip(snapshotOf(scene))).scene)
    expect(restored).toHaveLength(150)
    restored[149].geometry.computeBoundingBox()
    expect(restored[149].geometry.boundingBox!.max.x).toBe(75)
  })

  it('schreibt Daten erneut, wenn sie inzwischen gelöscht wurden', async () => {
    const scene = new Scene()
    scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()))
    const { blobs, store } = memoryStore()
    await storeAssets(captureSnapshot(snapshotOf(scene)), store)
    blobs.clear()
    await storeAssets(captureSnapshot(snapshotOf(scene)), store)
    expect(blobs.size).toBe(1)
  })
})

describe('unusedAssets', () => {
  const scene = (...assets: string[]) => ({ scene: { assets } as StoredSnapshot })

  it('behält geteilte Daten, bis der letzte Job sie nicht mehr braucht', () => {
    expect(unusedAssets(['a', 'b', 'c'], [scene('a', 'b'), scene('b')])).toEqual(['c'])
    expect(unusedAssets(['a', 'b', 'c'], [scene('b')])).toEqual(['a', 'c'])
    expect(unusedAssets(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })

  it('zählt fertige Jobs ohne Szene nicht mit', () => {
    expect(unusedAssets(['a'], [{ scene: null }])).toEqual(['a'])
  })
})
