/**
 * Datenmodell eines Projekts. Felder und Einheiten folgen com.eteks.sweethome3d.model
 * (Längen in cm, Winkel in Radiant), damit der Import/Export von .sh3d-Dateien 1:1 möglich ist.
 */

/**
 * Textur einer Fläche wie TextureImage in Sweet Home 3D: Bild (Katalog-URL oder Verweis
 * „content:…“) und Größe einer Kachel in cm.
 */
export interface TextureRef {
  catalogId: string | null
  name: string
  image: string
  width: number
  height: number
  /** Zusätzliche PBR-Karten (gleiche Kachelgröße wie {@code image}); Sweet Home 3D kennt nur das Farbbild. */
  maps?: TextureMaps
  /** Bibliothek, aus der die Textur stammt, siehe api/catalog.ts. */
  libraryId?: string | null
}

/** Verweise (URL oder „content:…“) auf Graustufen- bzw. Normalenbilder für physikalisch basiertes Rendern. */
export interface TextureMaps {
  normal?: string
  roughness?: string
  ao?: string
  metalness?: string
}

/** Licht eines Möbels wie HomeLight in Sweet Home 3D; Lagen der Quellen relativ zu Breite/Tiefe/Höhe. */
export interface LightInfo {
  /** 0 bis 1, Sweet Home 3D: 0,5 Standard. */
  power: number
  sources: { x: number; y: number; z: number; color: number; diameter: number }[]
}

/** Benutzerdefinierte Bibliothek, aus der ein Projekt Möbel oder Texturen verwendet. */
export interface LibraryInfo {
  id: string
  name: string
  version: string | null
  provider: string | null
  /** Bezugsquelle (z. B. URL), damit der Empfänger weiß, woher er den Katalog bekommt. */
  source: string | null
}

/**
 * Aussehen einer Fläche: Farbe (ARGB wie in Sweet Home 3D) oder Textur; beides {@code null}
 * bedeutet Standard.
 */
export interface Surface {
  color: number | null
  texture: TextureRef | null
}

export interface Wall {
  id: string
  xStart: number
  yStart: number
  xEnd: number
  yEnd: number
  /** Id der Wand, die am Startpunkt anschließt. */
  wallAtStart: string | null
  /** Id der Wand, die am Endpunkt anschließt. */
  wallAtEnd: string | null
  thickness: number
  /** Höhe in cm; {@code null} bedeutet Höhe der Ebene bzw. Standardhöhe des Projekts. */
  height: number | null
  /** Id der Ebene; {@code null}, solange das Projekt keine Ebenen hat. */
  level: string | null
  /** Seite links bzw. rechts in Zeichenrichtung (vom Start zum Ende). */
  leftSide?: Surface
  rightSide?: Surface
}

export interface Room {
  id: string
  name: string | null
  points: [number, number][]
  floorVisible: boolean
  ceilingVisible: boolean
  level: string | null
  floor?: Surface
  ceiling?: Surface
}

/** Maßlinie: gemessene Strecke und Abstand der Linie davon (positiv = links in Messrichtung). */
export interface DimensionLine {
  id: string
  xStart: number
  yStart: number
  xEnd: number
  yEnd: number
  offset: number
  level: string | null
}

/** Freier Text im Plan; (x, y) ist die Mitte der Grundlinie. */
export interface Label {
  id: string
  text: string
  x: number
  y: number
  angle: number
  /** Schriftgröße in cm (wie TextStyle in Sweet Home 3D). */
  fontSize: number
  color: number | null
  level: string | null
}

export const DEFAULT_LABEL_FONT_SIZE = 18

export interface HomePiece {
  id: string
  /** Id des Katalogeintrags, aus dem das Möbel erzeugt wurde. */
  catalogId: string | null
  name: string
  /** Mittelpunkt im Plan. */
  x: number
  y: number
  /** Höhe über dem Boden der eigenen Ebene. */
  elevation: number
  angle: number
  width: number
  depth: number
  height: number
  visible: boolean
  /** URL eines Katalogmodells oder Verweis „content:…“ auf importierten Inhalt, siehe model/contents.ts. */
  model: string | null
  modelRotation: number[][] | null
  icon: string | null
  planIcon: string | null
  doorOrWindow: boolean
  /** Nur bei Türen und Fenstern gesetzt. */
  doorOrWindowInfo: DoorOrWindowInfo | null
  color: number | null
  /** Textur über das ganze Modell; schließt {@code color} aus. */
  texture?: TextureRef | null
  /** Nur bei Leuchten gesetzt. */
  light?: LightInfo | null
  /** Bibliothek des Katalogeintrags; fehlt bei Möbeln aus dem Standardkatalog. */
  libraryId?: string | null
  level: string | null
}

/**
 * Lage einer Tür bzw. eines Fensters in der Wand. Anders als in Sweet Home 3D sind alle Werte
 * relativ zur Breite bzw. Tiefe des Möbels gespeichert, damit sie beim Skalieren stimmen.
 */
export interface DoorOrWindowInfo {
  /** Anteil der Tiefe, der in der Wand liegt. */
  wallThickness: number
  /** Abstand der Wand von der Vorderseite, als Anteil der Tiefe. */
  wallDistance: number
  widthDepthDeformable: boolean
  /** Flügel: Drehachse und Breite relativ zu Breite/Tiefe, Winkel in Radiant. */
  sashes: { xAxis: number; yAxis: number; width: number; startAngle: number; endAngle: number }[]
}

/**
 * Geschoss wie in Sweet Home 3D. Wände, Räume und Möbel gehören über {@code level} zu einer Ebene;
 * ein Projekt ohne Ebenen hat eine leere Liste und überall {@code null}.
 */
export interface Level {
  id: string
  name: string
  /** Höhe des Fußbodens über dem Gelände in cm. */
  elevation: number
  /** Dicke der Decke darunter. */
  floorThickness: number
  /** Standardhöhe der Wände dieser Ebene. */
  height: number
  viewable: boolean
}

/** Virtueller Besucher (Augenposition im Plan, Blickrichtung). */
export interface ObserverCamera {
  x: number
  y: number
  /** Augenhöhe in cm über dem Boden der gewählten Ebene. */
  z: number
  /** Blickrichtung im Plan in Radiant (0 = nach rechts, im Uhrzeigersinn, da y nach unten zeigt). */
  yaw: number
  /** Neigung nach oben (positiv) bzw. unten. */
  pitch: number
  /** Horizontaler Öffnungswinkel in Radiant. */
  fieldOfView: number
}

export type CameraMode = 'aerial' | 'observer'

export interface Home {
  formatVersion: 1
  wallHeight: number
  /** Nach Höhe sortiert, unterste zuerst. */
  levels: Level[]
  /** Ebene, die im Plan bearbeitet wird. */
  selectedLevel: string | null
  walls: Wall[]
  rooms: Room[]
  furniture: HomePiece[]
  dimensionLines: DimensionLine[]
  labels: Label[]
  camera: { mode: CameraMode; observer: ObserverCamera }
  /**
   * Benutzerdefinierte Bibliotheken, aus denen Möbel oder Texturen stammen, auch wenn sie hier
   * nicht installiert sind (z. B. aus einer weitergegebenen Datei), siehe catalog/libraries.ts.
   */
  libraries?: LibraryInfo[]
}

export function createEmptyHome(): Home {
  return {
    formatVersion: 1,
    wallHeight: 250,
    levels: [],
    selectedLevel: null,
    walls: [],
    rooms: [],
    furniture: [],
    dimensionLines: [],
    labels: [],
    camera: {
      mode: 'aerial',
      observer: { x: 50, y: 50, z: 170, yaw: Math.PI / 4, pitch: 0, fieldOfView: (63 * Math.PI) / 180 },
    },
  }
}

/** Ergänzt fehlende Felder, z. B. bei Projekten aus älteren Versionen. */
export function normalizeHome(raw: unknown): Home {
  const home = (raw && typeof raw === 'object' ? raw : {}) as Partial<Home>
  const empty = createEmptyHome()
  return {
    formatVersion: 1,
    wallHeight: home.wallHeight ?? empty.wallHeight,
    levels: home.levels ?? [],
    selectedLevel: home.selectedLevel ?? null,
    walls: (home.walls ?? []).map((w) => ({ ...w, level: w.level ?? null })),
    rooms: (home.rooms ?? []).map((r) => ({ ...r, level: r.level ?? null })),
    furniture: (home.furniture ?? []).map((p) => ({ ...p, doorOrWindowInfo: p.doorOrWindowInfo ?? null, level: p.level ?? null })),
    dimensionLines: home.dimensionLines ?? [],
    labels: home.labels ?? [],
    camera: home.camera ?? empty.camera,
  }
}

/** Alle Objekte, die auf einer Ebene liegen und im Plan ausgewählt werden können. */
export type HomeItem = Wall | Room | HomePiece | DimensionLine | Label

export function homeItems(home: Home): HomeItem[] {
  return [...home.walls, ...home.rooms, ...home.furniture, ...home.dimensionLines, ...home.labels]
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}
