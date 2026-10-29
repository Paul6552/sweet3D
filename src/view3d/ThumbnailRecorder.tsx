import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Home } from '../model/home'
import { saveThumbnail } from '../storage/projects'

/** Wartezeit nach der letzten Änderung, damit Modelle und Texturen geladen sind. */
const DELAY_MS = 3000
const WIDTH = 320
const HEIGHT = 200

/**
 * Hält ein Vorschaubild der 3D-Ansicht für die Projektliste aktuell: kurz nach dem Öffnen und
 * nach jeder Änderung an Wänden, Räumen, Möbeln oder Ebenen (nicht bei Kamerabewegungen).
 */
export function ThumbnailRecorder({ projectId, home }: { projectId: string; home: Home }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const { walls, rooms, furniture, levels, labels } = home

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Direkt nach dem Rendern ist der Zeichenpuffer noch gefüllt (ohne preserveDrawingBuffer)
      gl.render(scene, camera)
      const source = gl.domElement
      if (source.width === 0 || source.height === 0) return
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      // Mittiger Ausschnitt im Seitenverhältnis des Vorschaubilds
      const scale = Math.min(source.width / WIDTH, source.height / HEIGHT)
      const w = WIDTH * scale
      const h = HEIGHT * scale
      canvas.getContext('2d')?.drawImage(source, (source.width - w) / 2, (source.height - h) / 2, w, h, 0, 0, WIDTH, HEIGHT)
      canvas.toBlob((blob) => blob && void saveThumbnail(projectId, blob).catch(() => {}), 'image/webp', 0.8)
    }, DELAY_MS)
    return () => window.clearTimeout(timer)
    // Die Kamera ist absichtlich keine Abhängigkeit: das Bild zeigt die Ansicht zum Zeitpunkt der Änderung
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, walls, rooms, furniture, levels, labels, gl, scene])
  return null
}
