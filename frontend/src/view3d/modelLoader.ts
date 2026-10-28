import { Box3, DoubleSide, Group, LoadingManager, Material, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { resolveRef } from '../model/contents'

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

/**
 * Lädt ein OBJ-Modell samt Materialien (eigene MTL-Datei per mtllib, sonst die
 * Standard-Materialien) einmal pro Fenster. Liefert das ungeänderte Modell.
 * {@code ref} ist eine Katalog-URL oder ein Verweis auf importierten Inhalt; dessen Schlüssel
 * sind eindeutig, daher taugt der Verweis auch als Cache-Schlüssel.
 */
function loadObj(ref: string, contents: Record<string, string>): Promise<Group> {
  let model = models.get(ref)
  if (!model) {
    model = (async () => {
      const resolve = (url: string) => resolveRef(contents, url) ?? url
      const base = ref.substring(0, ref.lastIndexOf('/') + 1)
      const [text, defaults] = await Promise.all([fetch(resolve(ref)).then((r) => r.text()), loadDefaultMaterials()])
      const library = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim()
      let own: MaterialCreator | null = null
      if (library) {
        // MTL-Datei und Texturen relativ zum Modell, bei importierten Modellen aus den Inhalten
        const manager = new LoadingManager()
        manager.setURLModifier(resolve)
        const loader = new MTLLoader(manager).setPath(base).setResourcePath(base)
        own = await loader.loadAsync(library).catch(() => null)
        own?.preload()
      }
      const materials = {
        create: (name: string) => own?.materials[name] ?? own?.create(name) ?? defaults.create(name),
        preload: () => {},
      } as unknown as MaterialCreator
      const object = new OBJLoader().setMaterials(materials).parse(text)
      object.traverse((child) => {
        if (child instanceof Mesh) {
          const list = (Array.isArray(child.material) ? child.material : [child.material]) as Material[]
          // Viele Katalogmodelle sind nicht geschlossen: beide Seiten zeichnen
          list.forEach((m) => (m.side = DoubleSide))
          if (!child.material) child.material = new MeshStandardMaterial({ color: 0xcccccc, side: DoubleSide })
          child.castShadow = true
          child.receiveShadow = true
        }
      })
      return object
    })()
    models.set(ref, model)
  }
  return model
}

/**
 * Modell für ein Möbel wie in Sweet Home 3D (ModelManager): Modellrotation anwenden, dann so
 * skalieren, dass es genau width × height × depth einnimmt, unten mittig am Ursprung.
 */
export async function loadNormalizedModel(
  ref: string,
  contents: Record<string, string>,
  modelRotation: number[][] | null,
  size: { width: number; height: number; depth: number },
): Promise<Object3D> {
  const source = await loadObj(ref, contents)
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
