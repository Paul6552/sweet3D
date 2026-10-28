import { useEffect, useState } from 'react'

const cache = new Map<string, HTMLImageElement>()

/** Lädt ein Bild einmal pro Fenster und liefert es, sobald es fertig ist. */
export function useImage(url: string | null): HTMLImageElement | undefined {
  const [, setLoaded] = useState(0)
  const cached = url ? cache.get(url) : undefined
  useEffect(() => {
    if (!url || cache.has(url)) return
    const image = new window.Image()
    image.onload = () => {
      cache.set(url, image)
      setLoaded((n) => n + 1)
    }
    image.src = url
  }, [url])
  return cached
}
