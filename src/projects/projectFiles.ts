import { catalogApi, type CatalogPiece } from '../api/catalog'
import { exportSh3d } from '../io/sh3dExport'
import { importSh3d, projectNameFromFile, Sh3dImportError } from '../io/sh3dImport'
import type { Home } from '../model/home'
import { createProject, isQuotaError, requestPersistentStorage, type ProjectSummary } from '../storage/projects'

async function catalogPieces(language: string): Promise<CatalogPiece[]> {
  const catalog = await catalogApi.furniture(language)
  return catalog.categories.flatMap((c) => c.pieces)
}

/** Lädt ein Projekt als .sh3d-Datei herunter. */
export async function downloadSh3d(home: Home, name: string, language: string) {
  const blob = await exportSh3d(home, await catalogPieces(language))
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[\\/:*?"<>|]/g, '_') || 'Sweet3D'}.sh3d`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export type ImportOutcome =
  | { ok: true; project: ProjectSummary; missingModels: number }
  | { ok: false; error: 'notZip' | 'noXml' | 'quota' | 'failed' }

/** Importiert eine .sh3d-Datei als neues Projekt im Browser. */
export async function importSh3dFile(file: File, language: string): Promise<ImportOutcome> {
  return importSh3dData(file.arrayBuffer(), projectNameFromFile(file.name), language)
}

/** Legt ein neues Projekt aus dem mitgelieferten Beispielprojekt an. */
export async function createExampleProject(name: string, language: string): Promise<ImportOutcome> {
  const data = fetch('/examples/Beispielprojekt.sh3d').then((response) => {
    if (!response.ok) throw new Error(`Beispielprojekt nicht gefunden (${response.status})`)
    return response.arrayBuffer()
  })
  return importSh3dData(data, name, language)
}

async function importSh3dData(source: Promise<ArrayBuffer>, name: string, language: string): Promise<ImportOutcome> {
  try {
    const [data, catalog, textures] = await Promise.all([
      source,
      catalogPieces(language),
      catalogApi.textures(language).catch(() => null),
    ])
    const { home, contents, missingModels } = await importSh3d(new Uint8Array(data), catalog, textures)
    requestPersistentStorage()
    const project = await createProject(name, home, contents)
    return { ok: true, project, missingModels }
  } catch (error) {
    if (error instanceof Sh3dImportError) return { ok: false, error: error.reason }
    if (isQuotaError(error)) return { ok: false, error: 'quota' }
    console.error('Import fehlgeschlagen', error)
    return { ok: false, error: 'failed' }
  }
}
