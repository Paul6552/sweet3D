import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
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
}

interface Sweet3dDb extends DBSchema {
  projects: { key: string; value: ProjectSummary }
  /** Projektinhalt ohne importierte Dateien, Schlüssel ist die Projekt-Id. */
  homes: { key: string; value: Home }
  /** Importierte Modelle und Symbole, Schlüssel wie in „content:<Schlüssel>“ (siehe model/contents.ts). */
  contents: { key: string; value: Blob }
}

export type Db = IDBPDatabase<Sweet3dDb>

let db: Promise<Db> | null = null

export function openDatabase(): Promise<Db> {
  db ??= openDB<Sweet3dDb>('sweet3d', 1, {
    upgrade(database) {
      database.createObjectStore('projects', { keyPath: 'id' })
      database.createObjectStore('homes')
      database.createObjectStore('contents')
    },
  })
  return db
}

/** Alle Schlüssel mit diesem Präfix, z. B. die Dateien eines mehrteiligen Modells („<id>/“). */
export function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}￿`)
}
