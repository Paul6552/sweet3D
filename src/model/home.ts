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
  /** Oberkante folgt der Unterseite eines Dachs darüber (Giebel- und Kniestockwände). */
  toRoof?: boolean
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

/**
 * Abschnitt im Profil einer Dachkante: bis {@code height} (cm über der Traufe, {@code null} = bis
 * oben) hat die Dachfläche die Neigung {@code slope} (Radiant, π/2 = senkrecht, also Giebel).
 */
export interface RoofProfileStep {
  height: number | null
  slope: number
}

/** Einstellungen einer Kante des Dachs; {@code null} heißt: wie das ganze Dach. */
export interface RoofEdge {
  profile: RoofProfileStep[] | null
  overhang: number | null
}

/** Zuletzt gewählte Vorlage; „custom“, sobald Kanten einzeln geändert wurden. */
export type RoofShape = 'flat' | 'shed' | 'gable' | 'hip' | 'halfHip' | 'mansard' | 'mansardHip' | 'barrel' | 'custom'

/**
 * Dach (gibt es in Sweet Home 3D nicht): Grundriss an der Außenkante der Wände und Profil je Kante.
 * Die Flächen ergeben sich daraus über ein gewichtetes Straight Skeleton (model/roofs.ts).
 */
export interface Roof {
  id: string
  name: string | null
  level: string | null
  /** Traufpolygon an der Außenkante der Wände (ohne Überstand). */
  points: [number, number][]
  /** Innenhöfe; ihre Kanten haben die Einstellungen des Dachs. */
  holes: [number, number][][]
  /** {@code edges[i]} gehört zur Kante von {@code points[i]} nach {@code points[i + 1]}. */
  edges: RoofEdge[]
  /** Höhe, in der die Unterseite die Außenkante der Wände trifft; {@code null} = Wandhöhe der Ebene. */
  baseHeight: number | null
  /** Standardneigung in Radiant. */
  slope: number
  /** Standardüberstand über die Wand hinaus. */
  overhang: number
  /** Dicke senkrecht zur Dachfläche. */
  thickness: number
  /** Größte Höhe über der Traufe; darüber ist das Dach flach. */
  maxHeight: number | null
  /** Höhe der Brüstung (Attika) eines Flachdachs. */
  parapet: number | null
  shape: RoofShape
  /** Dachdeckung, Untersicht und Stirnseiten. */
  top?: Surface
  underside?: Surface
  sides?: Surface
  visible: boolean
  /** Gaube: Hauptdach, in das sie schneidet, und ihre Wände (werden mit ihr verschoben und gelöscht). */
  dormer?: { roofId: string; wallIds: string[] } | null
}

export const DEFAULT_ROOF_SLOPE = (35 * Math.PI) / 180
export const DEFAULT_ROOF_OVERHANG = 40
export const DEFAULT_ROOF_THICKNESS = 25

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
  /**
   * Nur bei Treppen gesetzt: Öffnung in Böden und Decken darüber als SVG-Pfad im Einheitsquadrat
   * (0..1, links oben = hinten links des Möbels) wie in Sweet Home 3D. Fehlt bei älteren Projekten.
   */
  staircaseCutOutShape?: string | null
  /** Bibliothek des Katalogeintrags; fehlt bei Möbeln aus dem Standardkatalog. */
  libraryId?: string | null
  /**
   * Neigung um die Breitenachse wie {@code pitch} in Sweet Home 3D (Dachfenster); die Unterkante des
   * geneigten Möbels liegt auf {@code elevation}.
   */
  pitch?: number
  /** Dachfenster: Dach, in dessen Fläche das Möbel sitzt und das es ausschneidet. */
  roofId?: string | null
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
  /** Dach-Niveau: nimmt die Dächer über dem Niveau darunter auf (Dach-Werkzeug). */
  roof?: boolean
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

/**
 * Kompass wie in Sweet Home 3D: Lage im Plan, Nordrichtung und geografische Lage des Projekts;
 * daraus und aus der Uhrzeit der Kamera ergibt sich der Sonnenstand.
 */
export interface Compass {
  x: number
  y: number
  diameter: number
  /** Richtung nach Norden in Radiant, im Uhrzeigersinn ab Plan-oben. */
  northDirection: number
  /** Breitengrad in Radiant, Norden positiv. */
  latitude: number
  /** Längengrad in Radiant, Osten positiv. */
  longitude: number
  /** IANA-Zeitzone, in der Datum und Uhrzeit angezeigt werden, z. B. Europe/Vienna. */
  timeZone: string
  visible: boolean
}

/** Bekannte Orte je Zeitzone (Breite, Länge in Grad), damit neue Projekte ungefähr richtig liegen. */
const PLACES: Record<string, [number, number]> = {
  'Europe/Vienna': [48.21, 16.37],
  'Europe/Berlin': [52.52, 13.4],
  'Europe/Zurich': [47.37, 8.54],
  'Europe/Paris': [48.86, 2.35],
  'Europe/London': [51.51, -0.13],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Madrid': [40.42, -3.7],
  'Europe/Amsterdam': [52.37, 4.9],
  'Europe/Brussels': [50.85, 4.35],
  'Europe/Prague': [50.08, 14.44],
  'Europe/Warsaw': [52.23, 21.01],
  'Europe/Budapest': [47.5, 19.04],
  'Europe/Stockholm': [59.33, 18.07],
  'Europe/Copenhagen': [55.68, 12.57],
  'America/New_York': [40.71, -74.01],
  'America/Chicago': [41.88, -87.63],
  'America/Los_Angeles': [34.05, -118.24],
}

export function defaultCompass(): Compass {
  let timeZone = 'Europe/Vienna'
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || timeZone
  } catch {
    // Ohne Intl bleibt es bei Wien
  }
  const [latitude, longitude] = PLACES[timeZone] ?? PLACES['Europe/Vienna']
  return {
    x: -100,
    y: 50,
    diameter: 100,
    northDirection: 0,
    latitude: (latitude * Math.PI) / 180,
    longitude: (longitude * Math.PI) / 180,
    timeZone,
    visible: true,
  }
}

/**
 * Platz für den Kompass links oben neben Wänden und Räumen (wie die Standardlage in Sweet Home 3D
 * neben einem Haus am Ursprung); {@code null}, wenn es noch nichts gibt.
 */
export function compassBesideHome(home: Pick<Home, 'walls' | 'rooms'>, diameter: number): { x: number; y: number } | null {
  const points = [...home.walls.flatMap((w) => [[w.xStart, w.yStart], [w.xEnd, w.yEnd]]), ...home.rooms.flatMap((r) => r.points)]
  if (points.length === 0) return null
  const minX = Math.min(...points.map((p) => p[0]))
  const minY = Math.min(...points.map((p) => p[1]))
  // Abstand reicht auch für die Mindestgröße, mit der der Plan den Kompass bei kleinem Zoom zeichnet
  const gap = Math.max(diameter, 400)
  return { x: Math.round(minX - gap), y: Math.round(minY + gap / 2) }
}

/** Heute 12 Uhr Ortszeit des Browsers, wie die Standardzeit der Kamera in Sweet Home 3D. */
export function defaultTime(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime()
}

export interface Home {
  formatVersion: 1
  wallHeight: number
  /** Nach Höhe sortiert, unterste zuerst. */
  levels: Level[]
  /** Ebene, die im Plan bearbeitet wird. */
  selectedLevel: string | null
  walls: Wall[]
  rooms: Room[]
  roofs: Roof[]
  furniture: HomePiece[]
  dimensionLines: DimensionLine[]
  labels: Label[]
  /** {@code time}: Zeitpunkt für den Sonnenstand in ms seit 1970 (UTC). */
  camera: { mode: CameraMode; observer: ObserverCamera; time: number }
  compass: Compass
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
    roofs: [],
    furniture: [],
    dimensionLines: [],
    labels: [],
    camera: {
      mode: 'aerial',
      observer: { x: 50, y: 50, z: 170, yaw: Math.PI / 4, pitch: 0, fieldOfView: (63 * Math.PI) / 180 },
      time: defaultTime(),
    },
    compass: defaultCompass(),
  }
}

/** Ergänzt fehlende Felder, z. B. bei Projekten aus älteren Versionen. */
export function normalizeHome(raw: unknown): Home {
  const home = (raw && typeof raw === 'object' ? raw : {}) as Partial<Home>
  const empty = createEmptyHome()
  const walls = (home.walls ?? []).map((w) => ({ ...w, level: w.level ?? null }))
  const rooms = (home.rooms ?? []).map((r) => ({ ...r, level: r.level ?? null }))
  // Projekte von vor dem Kompass: neben das Haus legen, sonst liegt er irgendwo außerhalb des Plans
  const compass = home.compass ? { ...empty.compass, ...home.compass } : { ...empty.compass, ...compassBesideHome({ walls, rooms }, empty.compass.diameter) }
  return {
    formatVersion: 1,
    wallHeight: home.wallHeight ?? empty.wallHeight,
    levels: home.levels ?? [],
    selectedLevel: home.selectedLevel ?? null,
    walls,
    rooms,
    roofs: (home.roofs ?? []).map((r) => ({ ...r, level: r.level ?? null })),
    furniture: (home.furniture ?? []).map((p) => ({ ...p, doorOrWindowInfo: p.doorOrWindowInfo ?? null, level: p.level ?? null })),
    dimensionLines: home.dimensionLines ?? [],
    labels: home.labels ?? [],
    camera: { ...empty.camera, ...home.camera },
    compass,
    ...(home.libraries && home.libraries.length > 0 ? { libraries: home.libraries } : {}),
  }
}

/** Alle Objekte, die auf einer Ebene liegen und im Plan ausgewählt werden können. */
export type HomeItem = Wall | Room | Roof | HomePiece | DimensionLine | Label

export function homeItems(home: Home): HomeItem[] {
  return [...home.walls, ...home.rooms, ...home.roofs, ...home.furniture, ...home.dimensionLines, ...home.labels]
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}
