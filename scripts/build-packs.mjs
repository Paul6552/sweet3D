// Erzeugt die mitgelieferten Zusatzkataloge unter public/packs als Bibliotheken im Format von
// Sweet Home 3D (.sh3f für Möbel, .sh3t für Texturen), siehe scripts/catalog-packs.json:
// - Poly Haven (CC0): glTF-Modelle werden zu OBJ/MTL mit PBR-Erweiterungen (Pr, Pm, map_Pr,
//   map_Pm, map_ao, norm), damit auch Sweet Home 3D sie öffnen kann; Texturen mit Normalen-,
//   Rauheits- und AO-Karten (Schlüssel normalMap#i usw., die Sweet Home 3D ignoriert)
// - freie Bibliotheken von Sweet Home 3D werden unverändert übernommen
// Heruntergeladene Dateien bleiben in vendor/packs-cache, spätere Läufe brauchen kein Netz.
// Aufruf: node scripts/build-packs.mjs [--force] [--offline]

import { NodeIO } from '@gltf-transform/core'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { libraryHeader, parseProperties, readFurnitureEntries, readTextureEntries } from '../src/catalog/sh3fParser.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(root, 'scripts', 'catalog-packs.json'), 'utf8'))
const cache = join(root, 'vendor', 'packs-cache')
const out = join(root, 'public', 'packs')
const offline = process.argv.includes('--offline')
const force = process.argv.includes('--force')
const API = 'https://api.polyhaven.com'
const THUMBS = 'https://cdn.polyhaven.com/asset_img/thumbs'
const HEADERS = { 'User-Agent': 'sweet3d-build (https://github.com/; catalog packs)' }
const resolution = config.resolution ?? '1k'

const stamp = join(out, '.stamp')
const inputs = [fileURLToPath(import.meta.url), join(root, 'scripts', 'catalog-packs.json')]
if (!force && existsSync(stamp) && inputs.every((file) => statSync(file).mtimeMs < statSync(stamp).mtimeMs)) {
  console.log('Zusatzkataloge sind aktuell')
  process.exit(0)
}

// ---------------------------------------------------------------- Herunterladen mit Zwischenspeicher

/** Datei aus dem Zwischenspeicher, sonst herunterladen (mit Wiederholung). */
async function cached(url, file) {
  const target = join(cache, file)
  if (existsSync(target) && statSync(target).size > 0) return readFileSync(target)
  if (offline) throw new Error(`offline, fehlt im Zwischenspeicher: ${file}`)
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: HEADERS, redirect: 'follow' })
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      return bytes
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
  throw lastError
}

const json = async (url, file) => JSON.parse((await cached(url, file)).toString('utf8'))

/** Führt {@code task} für alle Einträge mit begrenzter Parallelität aus; Fehler einzelner Einträge werden gemeldet. */
async function eachLimited(items, limit, task) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++
        try {
          results[index] = await task(items[index], index)
        } catch (error) {
          console.warn(`  übersprungen: ${items[index]?.id ?? items[index]}: ${error.message}`)
          results[index] = null
        }
      }
    }),
  )
  return results
}

// ---------------------------------------------------------------- .properties schreiben

/** Wert für eine .properties-Datei (ISO-8859-1; alles andere als \uXXXX). */
function escapeProperty(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function properties(entries) {
  return strToU8(
    entries
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${key}=${escapeProperty(value)}`)
      .join('\n') + '\n',
  )
}

// ---------------------------------------------------------------- glTF → OBJ/MTL

const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const fmt = (n) => (Math.abs(n) < 1e-7 ? '0' : Number(n.toFixed(6)).toString())

/** 4×4-Matrix (Spalten zuerst wie glTF) auf einen Punkt bzw. eine Richtung anwenden. */
function transformPoint(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
}

/** Normalenmatrix (inverse Transponierte des 3×3-Anteils). */
function normalMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e) || 1
  // Kofaktoren / det = (M⁻¹)ᵀ
  return [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ]
}

function transformNormal(n, x, y, z) {
  // n zeilenweise
  const rx = n[0] * x + n[1] * y + n[2] * z
  const ry = n[3] * x + n[4] * y + n[5] * z
  const rz = n[6] * x + n[7] * y + n[8] * z
  const length = Math.hypot(rx, ry, rz) || 1
  return [rx / length, ry / length, rz / length]
}

/**
 * Wandelt ein glTF-Modell in OBJ und MTL. Koordinaten bleiben in Metern (Sweet Home 3D skaliert
 * auf die Katalogmaße), V-Koordinaten werden gespiegelt (glTF oben links, OBJ unten links).
 * Liefert auch die Größe in cm und die verwendeten Bilder.
 */
async function gltfToObj(gltfPath, name) {
  const io = new NodeIO()
  const document = await io.read(gltfPath)
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]
  const lines = [`# ${name} von Poly Haven (CC0), umgewandelt von Sweet3D`, `mtllib ${name}.mtl`]
  const materials = new Map()
  const images = new Set()
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let vertexOffset = 0
  let uvOffset = 0
  let normalOffset = 0
  const materialName = (material) => {
    if (!material) return 'default'
    if (!materials.has(material)) materials.set(material, `m${materials.size}`)
    return materials.get(material)
  }
  scene.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    const world = node.getWorldMatrix()
    const normals = normalMatrix(world)
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue // nur Dreiecke
      const position = primitive.getAttribute('POSITION')
      if (!position) continue
      const normal = primitive.getAttribute('NORMAL')
      const uv = primitive.getAttribute('TEXCOORD_0')
      const count = position.getCount()
      const p = []
      for (let i = 0; i < count; i++) {
        const [x, y, z] = transformPoint(world, ...position.getElement(i, p))
        lines.push(`v ${fmt(x)} ${fmt(y)} ${fmt(z)}`)
        ;[x, y, z].forEach((value, axis) => {
          min[axis] = Math.min(min[axis], value)
          max[axis] = Math.max(max[axis], value)
        })
      }
      if (uv) for (let i = 0; i < count; i++) {
        const [u, v] = uv.getElement(i, p)
        lines.push(`vt ${fmt(u)} ${fmt(1 - v)}`)
      }
      if (normal) for (let i = 0; i < count; i++) {
        const [x, y, z] = transformNormal(normals, ...normal.getElement(i, p))
        lines.push(`vn ${fmt(x)} ${fmt(y)} ${fmt(z)}`)
      }
      lines.push(`usemtl ${materialName(primitive.getMaterial())}`)
      const indices = primitive.getIndices()
      const index = (i) => (indices ? indices.getScalar(i) : i)
      const total = indices ? indices.getCount() : count
      const corner = (i) => {
        const k = index(i)
        const v = vertexOffset + k + 1
        if (uv && normal) return `${v}/${uvOffset + k + 1}/${normalOffset + k + 1}`
        if (uv) return `${v}/${uvOffset + k + 1}`
        if (normal) return `${v}//${normalOffset + k + 1}`
        return `${v}`
      }
      for (let i = 0; i + 2 < total; i += 3) lines.push(`f ${corner(i)} ${corner(i + 1)} ${corner(i + 2)}`)
      vertexOffset += count
      if (uv) uvOffset += count
      if (normal) normalOffset += count
    }
  })
  if (vertexOffset === 0) throw new Error('keine Dreiecke')

  const mtl = [`# Materialien von ${name}`]
  const textureUri = (texture) => {
    const uri = texture?.getURI()
    if (uri) images.add(uri)
    return uri
  }
  for (const [material, id] of materials) {
    const [r, g, b, a] = material.getBaseColorFactor()
    const roughness = material.getRoughnessFactor()
    mtl.push('', `newmtl ${id}`)
    mtl.push(`Kd ${fmt(linearToSrgb(r))} ${fmt(linearToSrgb(g))} ${fmt(linearToSrgb(b))}`)
    mtl.push('Ka 0 0 0', 'Ks 0.04 0.04 0.04', `Ns ${fmt(Math.min(1000, 2 / Math.max(roughness, 0.05) ** 2 - 2))}`)
    mtl.push(`Pr ${fmt(roughness)}`, `Pm ${fmt(material.getMetallicFactor())}`)
    if (material.getAlphaMode() === 'BLEND' && a < 1) mtl.push(`d ${fmt(a)}`)
    // Blätter usw.: Bild mit Alphakanal, Kanten scharf abschneiden
    if (material.getAlphaMode() === 'MASK') mtl.push(`alphaTest ${fmt(material.getAlphaCutoff())}`)
    const color = textureUri(material.getBaseColorTexture())
    if (color) mtl.push(`map_Kd ${color}`)
    const normalMap = textureUri(material.getNormalTexture())
    if (normalMap) mtl.push(`norm ${normalMap}`)
    const metallicRoughness = textureUri(material.getMetallicRoughnessTexture())
    if (metallicRoughness) mtl.push(`map_Pr ${metallicRoughness}`, `map_Pm ${metallicRoughness}`)
    const occlusion = textureUri(material.getOcclusionTexture())
    if (occlusion) mtl.push(`map_ao ${occlusion}`)
  }
  // Größe in cm; Sweet Home 3D: Breite x, Höhe y, Tiefe z
  const size = { width: (max[0] - min[0]) * 100, height: (max[1] - min[1]) * 100, depth: (max[2] - min[2]) * 100 }
  return { obj: strToU8(lines.join('\n') + '\n'), mtl: strToU8(mtl.join('\n') + '\n'), images: [...images], size }
}

// ---------------------------------------------------------------- Poly Haven

const round1 = (n) => Math.round(n * 10) / 10

/** Erste Kategorie aus der Konfiguration, die das Asset hat (Reihenfolge der Konfiguration zählt). */
function categoryOf(asset, categories) {
  return Object.keys(categories).find((key) => asset.categories.includes(key)) ?? null
}

async function polyHavenModelPack(pack, assets) {
  const selected = Object.entries(assets)
    .filter(([, asset]) => categoryOf(asset, pack.categories) && (asset.polycount ?? Infinity) <= pack.maxPolycount)
    .filter(([, asset]) => !asset.categories.some((c) => c === 'rigged' || (pack.exclude ?? []).includes(c)))
    .sort(([, a], [, b]) => (b.download_count ?? 0) - (a.download_count ?? 0))
    .slice(0, pack.max ?? Infinity)
    .map(([id, asset]) => ({ id, asset }))
  console.log(`${pack.id}: ${selected.length} Modelle`)
  const files = {}
  const results = await eachLimited(selected, 6, async ({ id, asset }) => {
    const info = await json(`${API}/files/${id}`, `polyhaven/models/${id}/files.json`)
    const gltf = info.gltf?.[resolution]?.gltf
    if (!gltf) throw new Error(`kein glTF in ${resolution}`)
    const directory = `polyhaven/models/${id}/${resolution}/`
    await cached(gltf.url, `${directory}${id}.gltf`)
    for (const [path, include] of Object.entries(gltf.include ?? {})) await cached(include.url, directory + path)
    const icon = await cached(`${THUMBS}/${id}.png?width=256&height=256`, `polyhaven/models/${id}/icon.png`)
    const converted = await gltfToObj(join(cache, `${directory}${id}.gltf`), id)
    files[`${id}/${id}.obj`] = converted.obj
    files[`${id}/${id}.mtl`] = converted.mtl
    for (const image of converted.images) files[`${id}/${image}`] = [readFileSync(join(cache, directory, image)), { level: 0 }]
    files[`icons/${id}.png`] = [icon, { level: 0 }]
    return { id, asset, size: converted.size }
  })
  const entries = [
    ['id', `sweet3d.${pack.id}`],
    ['name', pack.name.en],
    ['description', pack.description.en],
    ['version', new Date().toISOString().slice(0, 10)],
    ['provider', 'Poly Haven'],
    ['license', 'CC0'],
  ]
  const german = [['name', pack.name.de], ['description', pack.description.de]]
  let n = 0
  for (const result of results) {
    if (!result) continue
    const { id, asset, size } = result
    const category = pack.categories[categoryOf(asset, pack.categories)]
    n++
    entries.push(
      [`id#${n}`, `polyhaven#${id}`],
      [`name#${n}`, asset.name],
      [`category#${n}`, category.en],
      [`creator#${n}`, Object.keys(asset.authors ?? {}).join(', ')],
      [`tags#${n}`, (asset.tags ?? []).join(',')],
      [`icon#${n}`, `/icons/${id}.png`],
      [`model#${n}`, `/${id}/${id}.obj`],
      [`multiPartModel#${n}`, 'true'],
      [`width#${n}`, round1(size.width)],
      [`depth#${n}`, round1(size.depth)],
      [`height#${n}`, round1(size.height)],
      [`movable#${n}`, 'true'],
      [`doorOrWindow#${n}`, 'false'],
    )
    if (category.light) {
      entries.push([`lightPower#${n}`, '0.5'], [`lightSourceX#${n}`, round1(size.width / 2)], [`lightSourceY#${n}`, round1(size.depth / 2)])
      entries.push([`lightSourceZ#${n}`, round1(size.height * 0.6)], [`lightSourceColor#${n}`, '#FFE2B8'], [`lightSourceDiameter#${n}`, round1(Math.min(size.width, 10))])
    }
    german.push([`name#${n}`, asset.name], [`category#${n}`, category.de])
  }
  files['PluginFurnitureCatalog.properties'] = properties(entries)
  files['PluginFurnitureCatalog_de.properties'] = properties(german)
  return writePack(pack, 'sh3f', files, { furniture: n, textures: 0, provider: 'Poly Haven', license: 'CC0' })
}

async function polyHavenTexturePack(pack, assets) {
  const perCategory = new Map()
  const selected = Object.entries(assets)
    .filter(([, asset]) => !asset.categories.some((c) => pack.exclude.includes(c) || c.startsWith('collection:')))
    .sort(([, a], [, b]) => (b.download_count ?? 0) - (a.download_count ?? 0))
    .filter(([, asset]) => {
      const key = categoryOf(asset, pack.categories)
      if (!key) return false
      const taken = perCategory.get(key) ?? 0
      if (taken >= (pack.categories[key].max ?? 10)) return false
      perCategory.set(key, taken + 1)
      return true
    })
    .map(([id, asset]) => ({ id, asset }))
  console.log(`${pack.id}: ${selected.length} Texturen`)
  const files = {}
  const results = await eachLimited(selected, 6, async ({ id, asset }) => {
    const info = await json(`${API}/files/${id}`, `polyhaven/textures/${id}/files.json`)
    const pick = (kind) => info[kind]?.[resolution]?.jpg
    // Stoffe gibt es teils nur in Farbvarianten (col_1, col_2, …)
    const color = pick('Diffuse') ?? pick(Object.keys(info).find((kind) => /^col_?\d/.test(kind)))
    if (!color) throw new Error('kein Farbbild')
    const maps = { image: color, normalMap: pick('nor_gl'), roughnessMap: pick('Rough') ?? pick('arm'), aoMap: pick('AO') ?? pick('arm') }
    const stored = {}
    for (const [key, file] of Object.entries(maps)) {
      if (!file) continue
      const name = file.url.split('/').pop()
      files[`${id}/${name}`] = [await cached(file.url, `polyhaven/textures/${id}/${name}`), { level: 0 }]
      stored[key] = `/${id}/${name}`
    }
    const icon = await cached(`${THUMBS}/${id}.png?width=128&height=128`, `polyhaven/textures/${id}/icon.png`)
    files[`icons/${id}.png`] = [icon, { level: 0 }]
    return { id, asset, stored }
  })
  const entries = [
    ['id', `sweet3d.${pack.id}`],
    ['name', pack.name.en],
    ['description', pack.description.en],
    ['version', new Date().toISOString().slice(0, 10)],
    ['provider', 'Poly Haven'],
    ['license', 'CC0'],
  ]
  const german = [['name', pack.name.de], ['description', pack.description.de]]
  let n = 0
  for (const result of results) {
    if (!result) continue
    const { id, asset, stored } = result
    const category = pack.categories[categoryOf(asset, pack.categories)]
    // Poly Haven gibt die Größe der Vorlage in mm an
    const [w, h] = asset.dimensions ?? [1000, 1000]
    n++
    entries.push(
      [`id#${n}`, `polyhaven#${id}`],
      [`name#${n}`, asset.name],
      [`category#${n}`, category.en],
      [`creator#${n}`, Object.keys(asset.authors ?? {}).join(', ')],
      [`image#${n}`, stored.image],
      [`icon#${n}`, `/icons/${id}.png`],
      [`normalMap#${n}`, stored.normalMap],
      [`roughnessMap#${n}`, stored.roughnessMap],
      [`aoMap#${n}`, stored.aoMap],
      [`width#${n}`, round1(w / 10)],
      [`height#${n}`, round1(h / 10)],
    )
    german.push([`name#${n}`, asset.name], [`category#${n}`, category.de])
  }
  files['PluginTexturesCatalog.properties'] = properties(entries)
  files['PluginTexturesCatalog_de.properties'] = properties(german)
  return writePack(pack, 'sh3t', files, { furniture: 0, textures: n, provider: 'Poly Haven', license: 'CC0' })
}

function writePack(pack, extension, files, info) {
  const file = `${pack.id}.${extension}`
  const bytes = zipSync(files, { level: 6 })
  writeFileSync(join(out, file), bytes)
  console.log(`  ${file}: ${(bytes.length / 1e6).toFixed(1)} MB`)
  return { id: `sweet3d.${pack.id}`, file, name: pack.name, description: pack.description, size: bytes.length, ...info }
}

// ---------------------------------------------------------------- Bibliotheken von Sweet Home 3D

/** Lädt ein ZIP der Sweet Home 3D-Seite und übernimmt die enthaltenen .sh3f-Dateien. */
async function sh3dPacks(entry) {
  const archive = await cached(entry.url, `sh3d/${entry.id}.zip`)
  const packs = []
  const isZip = archive[0] === 0x50 && archive[1] === 0x4b
  const libraries = isZip ? Object.entries(unzipSync(new Uint8Array(archive), { filter: (f) => /\.sh3[ft]$/i.test(f.name) })) : []
  if (libraries.length === 0) throw new Error(`keine Bibliothek in ${entry.url}`)
  for (const [name, bytes] of libraries) {
    const base = name.split('/').pop()
    const contents = unzipSync(bytes, { filter: (f) => /Catalog(_de)?\.properties$/.test(f.name) })
    const props = Object.entries(contents).find(([n]) => /Catalog\.properties$/.test(n))?.[1]
    const german = Object.entries(contents).find(([n]) => /Catalog_de\.properties$/.test(n))?.[1]
    if (!props) continue
    const parsed = parseProperties(props)
    const header = libraryHeader(parsed)
    const germanHeader = german ? libraryHeader(parseProperties(german)) : {}
    const file = `${entry.id}-${base}`.replace(/[^A-Za-z0-9._-]/g, '_')
    writeFileSync(join(out, file), bytes)
    const resolve = (path) => path ?? null
    const furniture = readFurnitureEntries(parsed, resolve).length
    const textures = readTextureEntries(parsed, resolve).length
    // Ohne id in der Datei nimmt der Import den Dateinamen (importName): dieselbe Id wie beim Import der Originaldatei
    packs.push({
      id: header.id ?? `file:${base.replace(/\.[^.]+$/, '')}`,
      file,
      importName: base,
      name: { en: header.name ?? base, de: germanHeader.name ?? header.name ?? base },
      description: { en: header.description ?? '', de: germanHeader.description ?? header.description ?? '' },
      size: bytes.length,
      furniture,
      textures,
      provider: header.provider ?? 'Sweet Home 3D',
      license: header.license ?? entry.license,
    })
    console.log(`  ${file}: ${furniture} Möbel, ${(bytes.length / 1e6).toFixed(1)} MB`)
  }
  return packs
}

// ---------------------------------------------------------------- Ablauf

// Nur den Inhalt leeren: ein neu angelegtes Verzeichnis liefert ein laufender Vite-Server nicht aus
mkdirSync(out, { recursive: true })
for (const file of readdirSync(out)) rmSync(join(out, file), { recursive: true, force: true })
const index = []
try {
  const models = await json(`${API}/assets?t=models`, 'polyhaven/models.json')
  for (const pack of config.polyHaven.models) index.push(await polyHavenModelPack(pack, models))
  const textures = await json(`${API}/assets?t=textures`, 'polyhaven/textures.json')
  for (const pack of config.polyHaven.textures) index.push(await polyHavenTexturePack(pack, textures))
} catch (error) {
  console.warn(`Poly Haven nicht verfügbar: ${error.message}`)
}
for (const entry of config.sh3d ?? []) {
  try {
    index.push(...(await sh3dPacks(entry)))
  } catch (error) {
    console.warn(`${entry.id} nicht verfügbar: ${error.message}`)
  }
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1))
writeFileSync(stamp, new Date().toISOString())
const total = readdirSync(out).reduce((sum, f) => sum + statSync(join(out, f)).size, 0)
console.log(`Zusatzkataloge erzeugt: ${index.length} Kataloge, ${(total / 1e6).toFixed(0)} MB`)
