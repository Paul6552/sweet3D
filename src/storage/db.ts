import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StoredLibrary } from '../catalog/libraries'
import type { Home } from '../model/home'

/**
 * Ablage aller Projekte in IndexedDB. Anders als der localStorage (rund 5 MB Text) darf IndexedDB
 * einen großen Teil des freien Speicherplatzes nutzen und speichert Modelle direkt als Blobs.
 */
export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** Vorschaubild aus der 3D-Ansicht. */
  thumbnail?: Blob
}

interface Sweet3dDb extends DBSchema {
  projects: { key: string; value: ProjectSummary }
  /** Projektinhalt ohne importierte Dateien, Schlüssel ist die Projekt-Id. */
  homes: { key: string; value: Home }
  /** Importierte Modelle und Symbole, Schlüssel wie in „content:<Schlüssel>“ (siehe model/contents.ts). */
  contents: { key: string; value: Blob }
  /** Importierte Möbel- und Texturbibliotheken; ihre Dateien liegen in contents. */
  libraries: { key: string; value: StoredLibrary }
}

export type Db = IDBPDatabase<Sweet3dDb>

let db: Promise<Db> | null = null

export function openDatabase(): Promise<Db> {
  db ??= openDB<Sweet3dDb>('sweet3d', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('projects', { keyPath: 'id' })
        database.createObjectStore('homes')
        database.createObjectStore('contents')
      }
      if (oldVersion < 2) database.createObjectStore('libraries', { keyPath: 'id' })
    },
  })
  return db
}

/** Alle Schlüssel mit diesem Präfix, z. B. die Dateien eines mehrteiligen Modells („<id>/“). */
export function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}￿`)
}
