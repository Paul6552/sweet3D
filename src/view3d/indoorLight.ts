import { useEffect, useMemo } from 'react'
import {
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  type Material,
  MeshStandardMaterial,
  RedFormat,
  RGBAFormat,
  ShaderChunk,
  UnsignedByteType,
  Vector2,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { argbToCss } from '../model/colors'
import { distanceToSegment, pointInPolygon, type Point, wallPolygon } from '../model/geometry'
import type { Home, HomePiece, Wall } from '../model/home'
import { defaultWallHeight, visibleLevels } from '../model/levels'
import { homeBounds } from '../plan/hitTest'
import type { Daylight } from './sky'

/**
 * Lichtstärke in Candela je Leistungseinheit einer Leuchte; die Szene ist in cm, daher groß (bei
 * 2 m Abstand ergibt Leistung 0,5 etwa ein Drittel der Sonne).
 */
export const CANDELA_PER_POWER = 80000

/** Rand um das Projekt in cm, damit das Freie rundherum sicher außen liegt. */
const MARGIN = 100
const MAX_CELLS = 256
const MIN_CELL = 10
/** Höchstens so viele Ebenen bekommen eine eigene Karte (im Shader fest). */
const MAX_LAYERS = 8
/** Himmelslicht unter einem Dach ohne Wände rundherum (Carport, Balkon darunter). */
const SHELTERED = 0.6
/** Anteil des Lichts durch eine Tür (meist undurchsichtiges Türblatt) gegenüber einem Fenster. */
const DOOR_FACTOR = 0.4
/** Ab dieser Brüstungshöhe gilt eine Öffnung als Fenster. */
const WINDOW_SILL = 30
/** Höhe, für die das Himmelslicht durch Fenster berechnet wird (etwa Tischhöhe). */
const RECEIVER_HEIGHT = 100
/** Verstärkung des Himmelslichts durch Fenster: Räume mit Fenstern sollen nicht düster wirken. */
const WINDOW_GAIN = 2.5
/** Anteil des Lichts, das im Raum von Wänden, Boden und Decke zurückgeworfen wird. */
const BOUNCE = 0.5
/** Weitergereichtes Himmelslicht aus einem Nachbarraum durch eine Innentür. */
const BORROWED = 0.5

/**
 * Licht in Innenräumen. Himmel (Umgebung) und Hemisphärenlicht kennen keine Verdeckung, daher
 * bekommt jede Ebene eine Karte im Planraster: a ist der Anteil des Himmelslichts (0 in einem
 * geschlossenen Raum ohne Fenster, 1 im Freien), rgb die Aufhellung durch zurückgeworfenes Licht
 * von Leuchten und durch Fenster einfallender Sonne. Alle Materialien des Hauses lesen die Karte
 * im Shader (siehe {@link patchIndoorLight}); direktes Sonnen- und Leuchtenlicht bleibt unberührt,
 * dafür sorgen die Schatten.
 */
interface Grid {
  minX: number
  minY: number
  cell: number
  nx: number
  ny: number
}

/** Öffnung von der Raumseite gesehen, für die einfallende Sonne. */
interface SunOpening {
  label: number
  area: number
  /** Richtung nach draußen im Plan. */
  outward: Point
}

interface Layer {
  bottom: number
  top: number
  /** Himmelslicht je Zelle. */
  sky: Float32Array
  /** Raum (zusammenhängende, von Wänden umschlossene Fläche) je Zelle; 0 im Freien. */
  label: Int32Array
  /** Raum mit Decke bzw. Ebene darüber je Raum. */
  roofed: boolean[]
  /** Innenfläche (Boden, Decke, Wände) je Raum in cm². */
  surface: number[]
  /** Zurückgeworfenes Licht der Leuchten je Raum (linear). */
  lamps: Color[]
  sunOpenings: SunOpening[]
}

export interface IndoorLight {
  grid: Grid
  layers: Layer[]
}

const OUTSIDE = 0
const NONE = -1

function cellIndex(grid: Grid, [x, y]: Point): number {
  const i = Math.floor((x - grid.minX) / grid.cell)
  const j = Math.floor((y - grid.minY) / grid.cell)
  return i < 0 || j < 0 || i >= grid.nx || j >= grid.ny ? -1 : j * grid.nx + i
}

function cellCenter(grid: Grid, index: number): Point {
  return [grid.minX + ((index % grid.nx) + 0.5) * grid.cell, grid.minY + (Math.floor(index / grid.nx) + 0.5) * grid.cell]
}

/** Markiert alle Zellen, deren Mitte im Polygon liegt. */
function fillPolygon(grid: Grid, polygon: Point[], mark: (index: number) => void) {
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - grid.minX) / grid.cell))
  const i1 = Math.min(grid.nx - 1, Math.floor((Math.max(...xs) - grid.minX) / grid.cell))
  const j0 = Math.max(0, Math.floor((Math.min(...ys) - grid.minY) / grid.cell))
  const j1 = Math.min(grid.ny - 1, Math.floor((Math.max(...ys) - grid.minY) / grid.cell))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const index = j * grid.nx + i
      if (pointInPolygon(cellCenter(grid, index), polygon)) mark(index)
    }
  }
}

/** Markiert die Zellen entlang einer Strecke, damit auch dünne Wände eine geschlossene Grenze bilden. */
function fillSegment(grid: Grid, a: Point, b: Point, mark: (index: number) => void) {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (grid.cell / 2)) + 1
  for (let s = 0; s <= steps; s++) {
    const index = cellIndex(grid, [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps])
    if (index >= 0) mark(index)
  }
}

function neighbours(grid: Grid, index: number): number[] {
  const i = index % grid.nx
  const result: number[] = []
  if (i > 0) result.push(index - 1)
  if (i < grid.nx - 1) result.push(index + 1)
  if (index >= grid.nx) result.push(index - grid.nx)
  if (index < grid.nx * (grid.ny - 1)) result.push(index + grid.nx)
  return result
}

/** Breitensuche von allen Zellen aus {@code queue}: unbelegte, erlaubte Nachbarn übernehmen deren Wert. */
function spread(grid: Grid, queue: number[], allowed: (index: number) => boolean, copy: (from: number, to: number) => void, taken: (index: number) => boolean) {
  for (let q = 0; q < queue.length; q++) {
    const from = queue[q]
    for (const to of neighbours(grid, from)) {
      if (taken(to) || !allowed(to)) continue
      copy(from, to)
      queue.push(to)
    }
  }
}

/** Wand, in der eine Tür bzw. ein Fenster sitzt. */
function wallOf(piece: HomePiece, walls: Wall[]): Wall | null {
  let best: Wall | null = null
  let bestDistance = Infinity
  for (const wall of walls) {
    const d = distanceToSegment([piece.x, piece.y], [wall.xStart, wall.yStart], [wall.xEnd, wall.yEnd])
    if (d <= wall.thickness / 2 + piece.depth / 2 && d < bestDistance) {
      best = wall
      bestDistance = d
    }
  }
  return best
}

function computeLayer(home: Home, grid: Grid, levelIds: Set<string | null>, bottom: number, top: number, aboveIds: Set<string>): Layer {
  const cells = grid.nx * grid.ny
  const walls = home.walls.filter((w) => levelIds.has(w.level))
  const wallsById = new Map(walls.map((w) => [w.id, w]))
  const height = top - bottom

  // Wände ins Raster; für das Abschließen der Räume zusätzlich um eine Zelle verbreitert, damit kleine Lücken an Ecken nicht stören
  const wall = new Uint8Array(cells)
  for (const w of walls) {
    if ((w.height ?? defaultWallHeight(home, w.level)) < height / 2) continue
    const mark = (index: number) => (wall[index] = 1)
    fillPolygon(grid, wallPolygon(w, wallsById), mark)
    fillSegment(grid, [w.xStart, w.yStart], [w.xEnd, w.yEnd], mark)
  }
  const blocked = wall.slice()
  for (let index = 0; index < cells; index++) if (wall[index]) for (const n of neighbours(grid, index)) blocked[n] = 1

  // Überdacht: Raum mit Decke auf dieser Ebene oder irgendein Raum darüber
  const covered = new Uint8Array(cells)
  for (const room of home.rooms) {
    if ((levelIds.has(room.level) && room.ceilingVisible) || (room.level !== null && aboveIds.has(room.level))) {
      fillPolygon(grid, room.points, (index) => (covered[index] = 1))
    }
  }

  // Draußen ist alles, was vom Rand aus erreichbar ist; jede übrige zusammenhängende Fläche ist ein Raum
  const label = new Int32Array(cells).fill(NONE)
  const border: number[] = []
  for (let index = 0; index < cells; index++) {
    const i = index % grid.nx
    const j = Math.floor(index / grid.nx)
    if ((i === 0 || j === 0 || i === grid.nx - 1 || j === grid.ny - 1) && !blocked[index]) {
      label[index] = OUTSIDE
      border.push(index)
    }
  }
  const free = (index: number) => !blocked[index]
  const labelled = (index: number) => label[index] !== NONE
  const copyLabel = (from: number, to: number) => (label[to] = label[from])
  spread(grid, border, free, copyLabel, labelled)
  let rooms = 0
  for (let index = 0; index < cells; index++) {
    if (blocked[index] || label[index] !== NONE) continue
    label[index] = ++rooms
    spread(grid, [index], free, copyLabel, labelled)
  }
  // Verbreiterte Ränder gehören zum angrenzenden Raum bzw. nach draußen
  spread(
    grid,
    [...label.keys()].filter((index) => label[index] !== NONE),
    (index) => !wall[index],
    copyLabel,
    labelled,
  )

  // Fläche, Umfang und Überdachung je Raum
  const area = new Array<number>(rooms + 1).fill(0)
  const edges = new Array<number>(rooms + 1).fill(0)
  const coveredCells = new Array<number>(rooms + 1).fill(0)
  for (let index = 0; index < cells; index++) {
    const l = label[index]
    if (l <= OUTSIDE) continue
    area[l]++
    if (covered[index]) coveredCells[l]++
    for (const n of neighbours(grid, index)) if (label[n] !== l) edges[l]++
  }
  const cellArea = grid.cell * grid.cell
  const surface = area.map((a, l) => Math.max(1, 2 * a * cellArea + edges[l] * grid.cell * height))
  const roofed = area.map((a, l) => l > OUTSIDE && coveredCells[l] > a / 2)

  // Türen und Fenster: je Seite, die in einem Raum liegt, eine Öffnung dorthin
  interface Opening {
    center: Point
    inward: Point
    area: number
    /** Höhe der Mitte über dem Boden. */
    z: number
    label: number
    other: number
    /** Himmelslicht auf der anderen Seite, falls diese kein überdachter Raum ist. */
    otherSky: number
  }
  const openings: Opening[] = []
  const sunOpenings: SunOpening[] = []
  for (const piece of home.furniture) {
    if (!piece.doorOrWindow || !piece.visible || !levelIds.has(piece.level)) continue
    const host = wallOf(piece, walls)
    if (!host) continue
    const length = Math.hypot(host.xEnd - host.xStart, host.yEnd - host.yStart)
    if (length === 0) continue
    const normal: Point = [-(host.yEnd - host.yStart) / length, (host.xEnd - host.xStart) / length]
    const reach = host.thickness / 2 + 1.5 * grid.cell
    const sides = [1, -1].map((sign) => {
      const index = cellIndex(grid, [piece.x + normal[0] * reach * sign, piece.y + normal[1] * reach * sign])
      return { sign, index, label: index < 0 ? OUTSIDE : label[index] }
    })
    const openHeight = Math.max(0, Math.min(piece.height, height - piece.elevation))
    const openArea = piece.width * openHeight * (piece.elevation >= WINDOW_SILL ? 1 : DOOR_FACTOR)
    if (openArea <= 0) continue
    for (const [side, other] of [sides, [...sides].reverse()]) {
      if (side.label <= OUTSIDE || side.label === other.label) continue
      const otherSky = other.label > OUTSIDE ? (roofed[other.label] ? 0 : 1) : other.index >= 0 && covered[other.index] ? SHELTERED : 1
      const inward: Point = [normal[0] * -other.sign, normal[1] * -other.sign]
      openings.push({ center: [piece.x, piece.y], inward, area: openArea, z: piece.elevation + openHeight / 2, label: side.label, other: other.label, otherSky })
      if (other.label <= OUTSIDE || !roofed[other.label]) sunOpenings.push({ label: side.label, area: openArea * otherSky, outward: [-inward[0], -inward[1]] })
    }
  }

  // Himmelslicht: im Freien 1, unter Dach ohne Wände etwas weniger, im überdachten Raum nur durch die Öffnungen
  const raw = new Float32Array(cells)
  const sky = new Float32Array(cells).fill(1)
  const roomCells: number[][] = Array.from({ length: rooms + 1 }, () => [])
  for (let index = 0; index < cells; index++) {
    const l = label[index]
    if (l === OUTSIDE && covered[index]) sky[index] = SHELTERED
    if (l > OUTSIDE && roofed[l]) roomCells[l].push(index)
  }
  const shine = (opening: Opening, light: number) => {
    const cellsOfRoom = roomCells[opening.label]
    // Licht, das im ganzen Raum zurückgeworfen wird, und direkter Blick durch die Öffnung (Raumwinkel)
    const bounce = (BOUNCE * opening.area * light) / surface[opening.label]
    const dz = opening.z - RECEIVER_HEIGHT
    for (const index of cellsOfRoom) {
      const [x, y] = cellCenter(grid, index)
      const dx = x - opening.center[0]
      const dy = y - opening.center[1]
      const r2 = dx * dx + dy * dy + dz * dz + opening.area / Math.PI
      const cos = Math.max(0, (dx * opening.inward[0] + dy * opening.inward[1]) / Math.sqrt(r2))
      raw[index] += bounce + (light * opening.area * cos) / (Math.PI * r2)
    }
  }
  for (const opening of openings) if (opening.other <= OUTSIDE || !roofed[opening.other]) shine(opening, opening.otherSky)
  const average = new Array<number>(rooms + 1).fill(0)
  for (let l = 1; l <= rooms; l++) {
    for (const index of roomCells[l]) average[l] += Math.min(1, WINDOW_GAIN * raw[index])
    average[l] /= Math.max(1, roomCells[l].length)
  }
  for (const opening of openings) if (opening.other > OUTSIDE && roofed[opening.other]) shine(opening, average[opening.other] * BORROWED)
  for (let l = 1; l <= rooms; l++) for (const index of roomCells[l]) sky[index] = Math.min(1, WINDOW_GAIN * raw[index])

  // Wände selbst übernehmen den Wert der Nachbarzelle (für Flächen genau an der Wand)
  spread(
    grid,
    [...label.keys()].filter((index) => label[index] !== NONE),
    () => true,
    (from, to) => {
      label[to] = label[from]
      sky[to] = sky[from]
    },
    labelled,
  )

  // Leuchten: ihr Licht wird im Raum zurückgeworfen und hellt ihn gleichmäßig auf
  const lamps = Array.from({ length: rooms + 1 }, () => new Color(0, 0, 0))
  for (const piece of home.furniture) {
    const light = piece.light
    if (!light || !piece.visible || light.power <= 0 || light.sources.length === 0 || !levelIds.has(piece.level)) continue
    const index = cellIndex(grid, [piece.x, piece.y])
    const l = index < 0 ? OUTSIDE : label[index]
    if (l <= OUTSIDE) continue
    const flux = 4 * Math.PI * light.power * CANDELA_PER_POWER
    const color = new Color(0, 0, 0)
    for (const source of light.sources) color.add(new Color(argbToCss(source.color)))
    color.multiplyScalar((BOUNCE * flux) / surface[l] / light.sources.length)
    lamps[l].add(color)
  }

  return { bottom, top, sky, label, roofed, surface, lamps, sunOpenings }
}

/** Karten für die sichtbaren Ebenen; Ebenen gleicher Höhe teilen sich eine. */
export function computeIndoorLight(home: Home): IndoorLight | null {
  const bounds = homeBounds(home)
  if (!bounds) return null
  const width = bounds.maxX - bounds.minX + 2 * MARGIN
  const depth = bounds.maxY - bounds.minY + 2 * MARGIN
  const cell = Math.max(MIN_CELL, width / MAX_CELLS, depth / MAX_CELLS)
  const grid: Grid = { minX: bounds.minX - MARGIN, minY: bounds.minY - MARGIN, cell, nx: Math.ceil(width / cell), ny: Math.ceil(depth / cell) }

  const groups: { elevation: number; ids: Set<string | null>; top: number }[] = []
  for (const level of visibleLevels(home)) {
    const elevation = level?.elevation ?? 0
    const top = elevation + (level?.height ?? home.wallHeight)
    const group = groups.find((g) => g.elevation === elevation)
    if (group) {
      group.ids.add(level?.id ?? null)
      group.top = Math.max(group.top, top)
    } else groups.push({ elevation, ids: new Set([level?.id ?? null]), top })
  }
  groups.sort((a, b) => a.elevation - b.elevation)
  const layers = groups.slice(-MAX_LAYERS).map(({ elevation, ids, top }) => {
    // Auch ausgeblendete Ebenen darüber decken ab, wie bei den Schatten der Sonne
    const above = new Set(home.levels.filter((l) => l.viewable && l.elevation > elevation).map((l) => l.id))
    return computeLayer(home, grid, ids, elevation, top, above)
  })
  return { grid, layers }
}

const emptyMap = new DataTexture(new Uint16Array([0, 0, 0, DataUtils.toHalfFloat(1)]), 1, 1, RGBAFormat, HalfFloatType)
emptyMap.needsUpdate = true
const emptyRooms = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType)
emptyRooms.needsUpdate = true

/** Gemeinsame Uniforms aller Materialien des Hauses. */
const uniforms = {
  indoorMap: { value: emptyMap as DataTexture },
  /** 1 in überdachten Räumen: dort gibt es bei „Räume immer hell“ keine Schatten. */
  indoorRooms: { value: emptyRooms as DataTexture },
  /** minX, minZ, 1 / Breite, 1 / Tiefe der Karte in cm. */
  indoorGrid: { value: new Vector4(0, 0, 1, 1) },
  /** Zeilen je Ebene, Anzahl der Ebenen. */
  indoorSize: { value: new Vector2(1, 1) },
  /** Fußboden und Oberkante je Ebene. */
  indoorLevels: { value: Array.from({ length: MAX_LAYERS }, () => new Vector2()) },
  indoorCount: { value: 0 },
  /** 0: Räume immer hell (Himmelslicht überall), 1: nur durch Öffnungen. */
  indoorEnabled: { value: 1 },
}

/** Schreibt die Karten in die Textur; die Sonne durch die Fenster hängt vom Sonnenstand ab. */
function writeIndoorLight(data: IndoorLight | null, light: Daylight) {
  if (!data || data.layers.length === 0) {
    uniforms.indoorCount.value = 0
    return
  }
  const { grid, layers } = data
  const cells = grid.nx * grid.ny
  let texture = uniforms.indoorMap.value
  if (texture === emptyMap || texture.image.width !== grid.nx || texture.image.height !== grid.ny * layers.length) {
    if (texture !== emptyMap) texture.dispose()
    texture = new DataTexture(new Uint16Array(cells * layers.length * 4), grid.nx, grid.ny * layers.length, RGBAFormat, HalfFloatType)
    texture.magFilter = texture.minFilter = LinearFilter
    uniforms.indoorMap.value = texture
    if (uniforms.indoorRooms.value !== emptyRooms) uniforms.indoorRooms.value.dispose()
    const rooms = new DataTexture(new Uint8Array(cells * layers.length), grid.nx, grid.ny * layers.length, RedFormat, UnsignedByteType)
    rooms.magFilter = rooms.minFilter = LinearFilter
    uniforms.indoorRooms.value = rooms
  }
  const roomPixels = uniforms.indoorRooms.value.image.data as Uint8Array
  const pixels = texture.image.data as Uint16Array
  const sun = light.direction
  layers.forEach((layer, n) => {
    // Sonne, die durch die Öffnungen fällt, wird im Raum zurückgeworfen
    const fill = layer.lamps.map((c) => c.clone())
    for (const opening of layer.sunOpenings) {
      const cos = opening.outward[0] * sun.x + opening.outward[1] * sun.z
      if (cos <= 0 || light.sunIntensity <= 0) continue
      fill[opening.label].add(light.sunColor.clone().multiplyScalar((light.sunIntensity * BOUNCE * opening.area * cos) / layer.surface[opening.label]))
    }
    const offset = n * cells * 4
    for (let index = 0; index < cells; index++) {
      const l = layer.label[index]
      const c = l > OUTSIDE ? fill[l] : null
      const p = offset + index * 4
      pixels[p] = DataUtils.toHalfFloat(c?.r ?? 0)
      pixels[p + 1] = DataUtils.toHalfFloat(c?.g ?? 0)
      pixels[p + 2] = DataUtils.toHalfFloat(c?.b ?? 0)
      pixels[p + 3] = DataUtils.toHalfFloat(layer.sky[index])
      roomPixels[n * cells + index] = l > OUTSIDE && layer.roofed[l] ? 255 : 0
    }
    uniforms.indoorLevels.value[n].set(layer.bottom, layer.top)
  })
  texture.needsUpdate = true
  uniforms.indoorRooms.value.needsUpdate = true
  uniforms.indoorGrid.value.set(grid.minX, grid.minY, 1 / (grid.nx * grid.cell), 1 / (grid.ny * grid.cell))
  uniforms.indoorSize.value.set(grid.ny, layers.length)
  uniforms.indoorCount.value = layers.length
}

/**
 * Berechnet die Karten neu, wenn sich Wände, Räume, Türen, Fenster oder Leuchten ändern, und
 * schreibt sie bei jedem neuen Sonnenstand. {@code bright}: Räume immer hell (zum Möblieren).
 */
export function IndoorLighting({ home, light, bright }: { home: Home; light: Daylight; bright: boolean }) {
  const { walls, rooms, furniture, levels, selectedLevel, wallHeight } = home
  // Andere Möbel beeinflussen das Licht nicht; beim Verschieben eines Stuhls nichts neu berechnen
  const relevant = JSON.stringify(
    furniture
      .filter((p) => p.doorOrWindow || p.light)
      .map((p) => [p.x, p.y, p.width, p.depth, p.height, p.elevation, p.angle, p.visible, p.level, p.light]),
  )
  const data = useMemo(
    () => computeIndoorLight(home),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relevant fasst die Türen, Fenster und Leuchten zusammen
    [walls, rooms, relevant, levels, selectedLevel, wallHeight],
  )
  useEffect(() => writeIndoorLight(data, light), [data, light])
  useEffect(() => {
    uniforms.indoorEnabled.value = bright ? 0 : 1
  }, [bright])
  return null
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vIndoorPosition;
varying vec3 vIndoorNormal;
`

const VERTEX_BODY = /* glsl */ `
vec4 indoorPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  indoorPosition = batchingMatrix * indoorPosition;
#endif
#ifdef USE_INSTANCING
  indoorPosition = instanceMatrix * indoorPosition;
#endif
vIndoorPosition = ( modelMatrix * indoorPosition ).xyz;
vIndoorNormal = mat3( modelMatrix ) * objectNormal;
`

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vIndoorPosition;
varying vec3 vIndoorNormal;
uniform sampler2D indoorMap;
uniform sampler2D indoorRooms;
uniform vec4 indoorGrid;
uniform vec2 indoorSize;
uniform vec2 indoorLevels[ ${MAX_LAYERS} ];
uniform int indoorCount;
uniform float indoorEnabled;

// Stelle in den Karten; false außerhalb (im Freien)
bool indoorUv( vec3 p, out vec2 uv ) {
  int layer = -1;
  for ( int i = 0; i < ${MAX_LAYERS}; i ++ ) {
    if ( i < indoorCount && p.y >= indoorLevels[ i ].x - 1.0 ) layer = i;
  }
  if ( layer < 0 || p.y > indoorLevels[ layer ].y + 5.0 ) return false;
  uv = ( p.xz - indoorGrid.xy ) * indoorGrid.zw;
  if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) return false;
  // Nur innerhalb der eigenen Ebene filtern
  uv.y = ( float( layer ) + clamp( uv.y, 0.5 / indoorSize.x, 1.0 - 0.5 / indoorSize.x ) ) / indoorSize.y;
  return true;
}
`

/**
 * Abgetastet wird etwas vor der Fläche: Außenseiten einer Wand liegen so draußen, Innenseiten im
 * Raum. Bei „Räume immer hell“ werfen in überdachten Räumen weder Sonne noch Leuchten Schatten.
 */
const FRAGMENT_LOOKUP = /* glsl */ `
vec3 indoorNormal = dot( vIndoorNormal, vIndoorNormal ) > 0.0 ? normalize( vIndoorNormal ) * faceDirection : vec3( 0.0 );
vec2 indoorPoint;
bool indoorInside = indoorUv( vIndoorPosition + indoorNormal * 15.0, indoorPoint );
bool indoorShadows = indoorEnabled > 0.5 || !indoorInside || texture2D( indoorRooms, indoorPoint ).r < 0.5;
`

/** rgb: zurückgeworfenes Licht, a: Anteil des Himmelslichts. */
const FRAGMENT_BODY = /* glsl */ `
#if defined( RE_IndirectDiffuse )
{
  vec4 indoorLight = indoorInside ? texture2D( indoorMap, indoorPoint ) : vec4( 0.0, 0.0, 0.0, 1.0 );
  indoorLight.a = mix( 1.0, indoorLight.a, indoorEnabled );
  irradiance = irradiance * indoorLight.a + indoorLight.rgb;
  iblIrradiance *= indoorLight.a;
  #if defined( RE_IndirectSpecular )
    radiance *= indoorLight.a;
  #endif
}
#endif
`

function indoorShader(shader: WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
    .replace('#include <lights_fragment_begin>', `${FRAGMENT_LOOKUP}\n${ShaderChunk.lights_fragment_begin.replaceAll('( directLight.visible && receiveShadow )', '( directLight.visible && receiveShadow && indoorShadows )')}`)
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAGMENT_BODY}`)
}

/** Lässt ein Material des Hauses die Innenraumkarte lesen (nur physikalisch basierte Materialien). */
export function patchIndoorLight<T extends Material>(material: T): T {
  if (material instanceof MeshStandardMaterial && !material.userData.indoorLight) {
    material.userData.indoorLight = true
    material.onBeforeCompile = indoorShader
  }
  return material
}
