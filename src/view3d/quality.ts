import { create } from 'zustand'

export type Quality = 'low' | 'medium' | 'high' | 'ultra'
export const QUALITIES: Quality[] = ['low', 'medium', 'high', 'ultra']

/** Was eine Qualitätsstufe in der 3D-Ansicht bedeutet. */
export interface QualityProfile {
  /** Bereich der Pixeldichte, den R3F je nach Gerät wählt. */
  dpr: [number, number]
  shadowMapSize: number
  /** Ambient Occlusion (Kontaktschatten in Ecken und unter Möbeln). */
  ao: boolean
  aoHalfRes: boolean
  bloom: boolean
  /** Kantenlänge der Würfelseiten für das Umgebungslicht aus dem Himmel. */
  environmentSize: number
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: { dpr: [1, 1], shadowMapSize: 1024, ao: false, aoHalfRes: true, bloom: false, environmentSize: 128 },
  medium: { dpr: [1, 1.5], shadowMapSize: 2048, ao: true, aoHalfRes: true, bloom: false, environmentSize: 256 },
  high: { dpr: [1, 2], shadowMapSize: 4096, ao: true, aoHalfRes: false, bloom: true, environmentSize: 256 },
  ultra: { dpr: [1, 2], shadowMapSize: 8192, ao: true, aoHalfRes: false, bloom: true, environmentSize: 512 },
}

const KEY = 'sweet3d.quality'

function initialQuality(): Quality {
  try {
    const value = localStorage.getItem(KEY)
    if (value && (QUALITIES as string[]).includes(value)) return value as Quality
  } catch {
    // Speicher nicht verfügbar
  }
  return 'high'
}

interface QualityState {
  quality: Quality
  setQuality: (quality: Quality) => void
}

/** Darstellungsqualität der 3D-Ansicht, je Browser gemerkt. */
export const useQualityStore = create<QualityState>((set) => ({
  quality: initialQuality(),
  setQuality: (quality) => {
    try {
      localStorage.setItem(KEY, quality)
    } catch {
      // Speicher nicht verfügbar: gilt dann nur in diesem Fenster
    }
    set({ quality })
  },
}))
