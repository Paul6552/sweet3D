// Erzeugt den Möbel- und Texturkatalog als statische Dateien unter public/catalog aus den
// Original-JARs von Sweet Home 3D (vendor/sh3d). Läuft vor `dev` und `build`; die Ausgabe
// wird nur neu erzeugt, wenn sich JARs oder dieses Skript geändert haben.
//
// Die Umrechnungen entsprechen com.eteks.sweethome3d.io.DefaultFurnitureCatalog bzw.
// DefaultTexturesCatalog: Flügel und Wandlage relativ zu Breite/Tiefe, Winkel in Radiant.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'vendor', 'sh3d')
const out = join(root, 'public', 'catalog')
const LANGUAGES = ['de', 'en', 'fr', 'es', 'it']
const RESOURCE_ROOT = 'com/eteks/sweethome3d/io/resources/'
const RESOURCE_URL = '/catalog/resources/'
const RESOURCE_EXTENSIONS = /\.(obj|mtl|png|jpe?g|gif|svg)$/i

const jars = ['Furniture.jar', 'Textures.jar', 'SweetHome3D.jar'].map((name) => join(vendor, name))
const stamp = join(out, '.stamp')
const inputsChanged = () => {
  if (!existsSync(stamp)) return true
  const built = statSync(stamp).mtimeMs
  return [...jars, fileURLToPath(import.meta.url)].some((file) => statSync(file).mtimeMs > built)
}

if (!inputsChanged() && !process.argv.includes('--force')) {
  console.log('Katalog ist aktuell')
  process.exit(0)
}

/** Liest eine Java-.properties-Datei (ISO-8859-1, Fortsetzungszeilen, \uXXXX-Escapes). */
function parseProperties(bytes) {
  const text = new TextDecoder('latin1').decode(bytes)
  const result = new Map()
  const lines = text.split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^[ \t\f]+/, '')
    if (!line || line[0] === '#' || line[0] === '!') continue
    // Eine ungerade Anzahl Backslashes am Zeilenende setzt die Zeile fort
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i].replace(/^[ \t\f]+/, '')
    }
    const match = /^((?:\\.|[^=:\s\\])*)\s*[=:\s]?\s*(.*)$/s.exec(line)
    if (match) result.set(unescape(match[1]), unescape(match[2]))
  }
  return result
}

function unescape(value) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => {
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16))
    return { t: '\t', n: '\n', r: '\r', f: '\f' }[c] ?? c
  })
}

/** Liest Basis- und Sprachdatei wie ein ResourceBundle (Sprache überschreibt Basis). */
function bundle(files, base, language) {
  const merged = new Map(parseProperties(files[`com/eteks/sweethome3d/io/${base}.properties`]))
  const localized = files[`com/eteks/sweethome3d/io/${base}_${language}.properties`]
  if (localized) for (const [key, value] of parseProperties(localized)) merged.set(key, value)
  return merged
}

function resourceUrl(path) {
  if (!path) return null
  const index = path.indexOf(RESOURCE_ROOT)
  return index < 0 ? null : RESOURCE_URL + path.slice(index + RESOURCE_ROOT.length)
}

const float = (value) => Number.parseFloat(value)
const floats = (value) => value.trim().split(/\s+/).map(float)
const radians = (degrees) => (degrees * Math.PI) / 180

/**
 * Sortiert wie FurnitureCatalog/TexturesCatalog: java.text.Collator ignoriert Leerzeichen und
 * Bindestriche, aber z. B. keine Apostrophe. Bei gleichem Namen fügt Sweet Home 3D per Binärsuche vor dem vorhandenen
 * Eintrag ein, der spätere Eintrag steht also vorn.
 */
function sortedCatalog(categories, language, itemsKey) {
  const intl = new Intl.Collator(language)
  const strip = (name) => name.replace(/[\s-]/g, '')
  const collator = { compare: (a, b) => intl.compare(strip(a), strip(b)) }
  const byName = (items) =>
    items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => collator.compare(a.item.name, b.item.name) || b.index - a.index)
      .map(({ item }) => item)
  return [...categories.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([name, items]) => ({ name, [itemsKey]: byName(items) }))
}

function readFurniture(props, language) {
  const get = (key, i) => props.get(`${key}#${i}`)
  const bool = (key, i, fallback) => (get(key, i) === undefined ? fallback : get(key, i) === 'true')
  const categories = new Map()
  for (let i = 1; get('id', i) !== undefined || get('name', i) !== undefined; i++) {
    const width = float(get('width', i))
    const depth = float(get('depth', i))
    const height = float(get('height', i))
    const doorOrWindow = get('doorOrWindow', i) === 'true'
    const rotation = get('modelRotation', i) ? floats(get('modelRotation', i)) : [1, 0, 0, 0, 1, 0, 0, 0, 1]
    let doorInfo = null
    if (doorOrWindow) {
      const list = (key) => (get(key, i) ? floats(get(key, i)) : [])
      const xAxis = list('doorOrWindowSashXAxis')
      const yAxis = list('doorOrWindowSashYAxis')
      const widths = list('doorOrWindowSashWidth')
      const starts = list('doorOrWindowSashStartAngle')
      const ends = list('doorOrWindowSashEndAngle')
      doorInfo = {
        wallThickness: ((get('doorOrWindowWallThickness', i) ? float(get('doorOrWindowWallThickness', i)) : depth) / depth),
        wallDistance: ((get('doorOrWindowWallDistance', i) ? float(get('doorOrWindowWallDistance', i)) : 0) / depth),
        wallCutOutOnBothSides: bool('doorOrWindowWallCutOutOnBothSides', i, true),
        widthDepthDeformable: bool('doorOrWindowWidthDepthDeformable', i, true),
        cutOutShape: get('doorOrWindowCutOutShape', i) ?? null,
        sashes: xAxis.map((x, s) => ({
          xAxis: (x / width),
          yAxis: (yAxis[s] / depth),
          width: (widths[s] / width),
          startAngle: radians(starts[s]),
          endAngle: radians(ends[s]),
        })),
      }
    }
    // Leuchten: Lage der Quellen relativ zu Breite, Tiefe und Höhe, Farben als #RRGGBB
    let light = null
    if (get('lightSourceX', i)) {
      const list = (key) => (get(key, i) ? get(key, i).trim().split(/\s+/) : [])
      const ys = list('lightSourceY')
      const zs = list('lightSourceZ')
      const colors = list('lightSourceColor')
      const diameters = list('lightSourceDiameter')
      light = {
        power: get('lightPower', i) ? float(get('lightPower', i)) : 0.5,
        sources: list('lightSourceX').map((x, s) => ({
          x: float(x),
          y: float(ys[s]),
          z: float(zs[s]),
          color: colors[s] ? Number.parseInt(colors[s].replace('#', ''), 16) : 0xffffff,
          diameter: diameters[s] ? float(diameters[s]) : 0,
        })),
      }
    }
    const piece = {
      id: get('id', i) ?? null,
      name: get('name', i),
      description: get('description', i) ?? null,
      creator: get('creator', i) ?? null,
      tags: get('tags', i) ? get('tags', i).split(/\s*,\s*/) : [],
      icon: resourceUrl(get('icon', i)),
      planIcon: resourceUrl(get('planIcon', i)),
      model: resourceUrl(get('model', i)),
      modelRotation: [rotation.slice(0, 3), rotation.slice(3, 6), rotation.slice(6, 9)],
      width,
      depth,
      height,
      elevation: get('elevation', i) ? float(get('elevation', i)) : 0,
      dropOnTopElevation: get('dropOnTopElevation', i) ? (float(get('dropOnTopElevation', i)) / height) : 1,
      movable: get('movable', i) === 'true',
      resizable: bool('resizable', i, true),
      deformable: bool('deformable', i, true),
      texturable: bool('texturable', i, true),
      // Türen und Fenster lassen sich in Sweet Home 3D nie horizontal kippen
      horizontallyRotatable: !doorOrWindow && bool('horizontallyRotatable', i, true),
      backFaceShown: bool('backFaceShown', i, false),
      color: get('color', i) ? Number.parseInt(get('color', i)) : null,
      staircaseCutOutShape: get('staircaseCutOutShape', i) ?? null,
      doorOrWindow: doorInfo,
      light,
    }
    const category = get('category', i)
    if (!categories.has(category)) categories.set(category, [])
    categories.get(category).push(piece)
  }
  return { language, categories: sortedCatalog(categories, language, 'pieces') }
}

function readTextures(props, language) {
  const categories = new Map()
  for (let i = 1; props.has(`id#${i}`) || props.has(`name#${i}`); i++) {
    const image = resourceUrl(props.get(`image#${i}`))
    const texture = {
      id: props.get(`id#${i}`) ?? null,
      name: props.get(`name#${i}`),
      creator: props.get(`creator#${i}`) ?? null,
      image,
      icon: image,
      width: float(props.get(`width#${i}`)),
      height: float(props.get(`height#${i}`)),
    }
    const category = props.get(`category#${i}`)
    if (!categories.has(category)) categories.set(category, [])
    categories.get(category).push(texture)
  }
  return { language, categories: sortedCatalog(categories, language, 'textures') }
}

/**
 * Liest die Konstante JAVA_3D_MATERIALS (Standard-Materialien für OBJ-Modelle, die per usemtl
 * ohne eigene MTL-Datei auskommen) aus dem Konstantenpool von OBJLoader.class.
 */
function readDefaultMaterials(classFile) {
  const view = new DataView(classFile.buffer, classFile.byteOffset, classFile.byteLength)
  let pos = 8 // magic, minor, major
  const count = view.getUint16(pos)
  pos += 2
  for (let i = 1; i < count; i++) {
    const tag = view.getUint8(pos++)
    switch (tag) {
      case 1: {
        const length = view.getUint16(pos)
        const value = new TextDecoder().decode(classFile.subarray(pos + 2, pos + 2 + length))
        pos += 2 + length
        if (value.startsWith('newmtl ')) return value
        break
      }
      case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18:
        pos += 4
        break
      case 5: case 6: // Long und Double belegen zwei Einträge
        pos += 8
        i++
        break
      case 7: case 8: case 16: case 19: case 20:
        pos += 2
        break
      case 15:
        pos += 3
        break
      default:
        throw new Error(`Unbekannter Konstantentyp ${tag} in OBJLoader.class`)
    }
  }
  throw new Error('JAVA_3D_MATERIALS nicht in OBJLoader.class gefunden')
}

const OBJ_LOADER = 'com/eteks/sweethome3d/j3d/OBJLoader.class'
const [furnitureJar, texturesJar] = jars.slice(0, 2).map((file) => unzipSync(readFileSync(file)))
const objLoader = unzipSync(readFileSync(jars[2]), { filter: (f) => f.name === OBJ_LOADER })[OBJ_LOADER]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

let resources = 0
// Mehrteilige Modelle liegen in einem eigenen Verzeichnis (OBJ, MTL, Texturen); der .sh3d-Export
// muss alle Dateien kennen. Schlüssel ist das Verzeichnis relativ zu den Ressourcen.
const modelParts = {}
for (const files of [furnitureJar, texturesJar]) {
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(RESOURCE_ROOT) || !RESOURCE_EXTENSIONS.test(name)) continue
    const relative = name.slice(RESOURCE_ROOT.length)
    const target = join(out, 'resources', relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    resources++
    const slash = relative.lastIndexOf('/')
    if (slash > 0 && !relative.startsWith('textures/')) {
      const directory = RESOURCE_URL + relative.slice(0, slash + 1)
      ;(modelParts[directory] ??= []).push(relative.slice(slash + 1))
    }
  }
}
writeFileSync(join(out, 'model-parts.json'), JSON.stringify(modelParts))

for (const language of LANGUAGES) {
  const furniture = readFurniture(bundle(furnitureJar, 'DefaultFurnitureCatalog', language), language)
  const textures = readTextures(bundle(texturesJar, 'DefaultTexturesCatalog', language), language)
  writeFileSync(join(out, `furniture-${language}.json`), JSON.stringify(furniture))
  writeFileSync(join(out, `textures-${language}.json`), JSON.stringify(textures))
}
writeFileSync(join(out, 'default-materials.mtl'), readDefaultMaterials(objLoader))
writeFileSync(stamp, new Date().toISOString())
console.log(`Katalog erzeugt: ${LANGUAGES.length} Sprachen, ${resources} Ressourcen`)
