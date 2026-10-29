// Erzeugt den Möbel- und Texturkatalog als statische Dateien unter public/catalog aus den
// Original-JARs von Sweet Home 3D (vendor/sh3d). Läuft vor `dev` und `build`; die Ausgabe
// wird nur neu erzeugt, wenn sich JARs, dieses Skript oder der Parser geändert haben.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
// Gemeinsamer Parser mit dem Import im Browser (Node lädt TypeScript ohne Typen direkt)
import { groupByCategory, mergeBundles, parseProperties, readFurnitureEntries, readTextureEntries } from '../src/catalog/sh3fParser.ts'

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
  const parser = join(root, 'src', 'catalog', 'sh3fParser.ts')
  return [...jars, fileURLToPath(import.meta.url), parser].some((file) => statSync(file).mtimeMs > built)
}

if (!inputsChanged() && !process.argv.includes('--force')) {
  console.log('Katalog ist aktuell')
  process.exit(0)
}

/** Liest Basis- und Sprachdatei wie ein ResourceBundle (Sprache überschreibt Basis). */
function bundle(files, base, language) {
  const localized = files[`com/eteks/sweethome3d/io/${base}_${language}.properties`]
  return mergeBundles(parseProperties(files[`com/eteks/sweethome3d/io/${base}.properties`]), localized && parseProperties(localized))
}

function resourceUrl(path) {
  if (!path) return null
  const index = path.indexOf(RESOURCE_ROOT)
  return index < 0 ? null : RESOURCE_URL + path.slice(index + RESOURCE_ROOT.length)
}

function readFurniture(props, language) {
  const entries = readFurnitureEntries(props, resourceUrl).map(({ category, piece }) => ({ category, item: piece }))
  return { language, categories: groupByCategory(entries, language).map(({ name, items }) => ({ name, pieces: items })) }
}

function readTextures(props, language) {
  const entries = readTextureEntries(props, resourceUrl).map(({ category, texture }) => ({ category, item: texture }))
  return { language, categories: groupByCategory(entries, language).map(({ name, items }) => ({ name, textures: items })) }
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
