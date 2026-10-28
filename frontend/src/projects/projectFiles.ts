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
  try {
    const [data, catalog] = await Promise.all([file.arrayBuffer(), catalogPieces(language)])
    const { home, contents, missingModels } = await importSh3d(new Uint8Array(data), catalog)
    requestPersistentStorage()
    const project = await createProject(projectNameFromFile(file.name), home, contents)
    return { ok: true, project, missingModels }
  } catch (error) {
    if (error instanceof Sh3dImportError) return { ok: false, error: error.reason }
    if (isQuotaError(error)) return { ok: false, error: 'quota' }
    console.error('Import fehlgeschlagen', error)
    return { ok: false, error: 'failed' }
  }
}
