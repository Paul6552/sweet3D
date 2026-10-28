import { useEffect, useState } from 'react'
import { contentKey, isContentRef } from '../model/contents'
import { openDatabase, prefixRange } from './db'

const urls = new Map<string, Promise<string | null>>()

/** Object-URL eines importierten Inhalts, einmal je Fenster aus IndexedDB erzeugt. */
export function contentUrl(key: string): Promise<string | null> {
  let url = urls.get(key)
  if (!url) {
    url = openDatabase()
      .then((db) => db.get('contents', key))
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
    urls.set(key, url)
  }
  return url
}

/** Object-URLs aller Dateien eines mehrteiligen Modells, Schlüssel „<id>/<Datei>“. */
export async function contentUrlsWithPrefix(prefix: string): Promise<Map<string, string>> {
  const keys = await (await openDatabase()).getAllKeys('contents', prefixRange(prefix))
  const entries = await Promise.all(keys.map(async (key) => [key, await contentUrl(key)] as const))
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null))
}

/** Inhalte für den Export: ein einzelner Schlüssel oder alle mit diesem Präfix. */
export async function contentBlobs(keyOrPrefix: string, prefix: boolean): Promise<[string, Blob][]> {
  const db = await openDatabase()
  if (!prefix) {
    const blob = await db.get('contents', keyOrPrefix)
    return blob ? [[keyOrPrefix, blob]] : []
  }
  const range = prefixRange(keyOrPrefix)
  const [keys, blobs] = await Promise.all([db.getAllKeys('contents', range), db.getAll('contents', range)])
  return keys.map((key, i) => [key, blobs[i]])
}

/** Ladbare URL für eine Katalog-URL oder einen Verweis auf importierten Inhalt (sobald geladen). */
export function useResolvedRef(ref: string | null): string | null {
  const [resolved, setResolved] = useState<{ ref: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!ref || !isContentRef(ref)) return
    let cancelled = false
    void contentUrl(contentKey(ref)).then((url) => !cancelled && setResolved({ ref, url }))
    return () => {
      cancelled = true
    }
  }, [ref])
  if (!ref || !isContentRef(ref)) return ref
  return resolved?.ref === ref ? resolved.url : null
}
