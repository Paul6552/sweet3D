import Box from '@mui/material/Box'
import { produce } from 'immer'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Stage } from 'react-konva'
import { useTranslation } from 'react-i18next'
import { CATALOG_PIECE_MIME, useCatalogStore } from '../catalog/catalogStore'
import { applyCommand, type HomeCommand } from '../model/commands'
import { pieceFromCatalog } from '../model/furniture'
import { dimensionLength, distance, distanceToSegment, pointInPolygon, signedOffset, toPieceLocal, wallLength, type Point } from '../model/geometry'
import { newId, type DimensionLine, type Home, type HomePiece, type ObserverCamera, type Wall } from '../model/home'
import { homeOnLevel, levelBelow, levelElevation, onLevel } from '../model/levels'
import { createRoof, outlineFromWalls, rawRoofModel, roofContour, skylightPlacement, wallsUnderRoofEdge } from '../model/roofs'
import { isDialogOpen, openCompassDialog, openItemDialog, useDialogStore } from '../dialogs/dialogStore'
import { dispatch, executeCommand, useEditorStore } from '../store/editorStore'
import { handlePoints, hitCompass, hitHandle, hitItem, hitObserver, homeBounds, itemsInRect, type Handle } from './hitTest'
import {
  magnetizeWallEnd,
  normalizeAngle,
  roomSnapPoints,
  snapAngle,
  snapDoorOrWindowToWall,
  snapToFreeWallEnd,
  snapToPoints,
  type WallEndSnap,
} from './magnetism'
import { PlanRenderer, type PlanPreview } from './PlanRenderer'
import { RoofEdgeMenu, type RoofMenuTarget } from './RoofEdgeMenu'
import { usePlanStore, zoomAt, type PlanView } from './planStore'
import { detectRoom } from './roomDetection'
import { createWallCommand, DEFAULT_WALL_THICKNESS, moveWallEndCommand } from './wallEditing'

/** Laufende Mausaktion im Plan. */
type Gesture =
  | { kind: 'pan'; startX: number; startY: number; view: PlanView }
  | { kind: 'rubberBand'; start: Point; current: Point; base: string[] }
  | { kind: 'move'; start: Point; current: Point; ids: string[]; magnetism: boolean }
  | { kind: 'handle'; handle: Handle; current: Point; magnetism: boolean }
  | { kind: 'observer'; part: 'move' | 'rotate'; start: Point; camera: ObserverCamera }
  | { kind: 'compass'; start: Point; current: Point }

/** Wandkette im Wand-Modus: Startpunkt der nächsten Wand und woran sie anschließt. */
interface WallChain {
  start: Point
  join: WallEndSnap | null
  /** Zuletzt gezeichnete Wand, deren freies Ende am Startpunkt liegt. */
  previousId: string | null
}

/** Maßlinie im Entstehen: erst Start, dann Ende, dann Abstand. */
interface DimensionDraft {
  start: Point
  end: Point | null
}

const HANDLE_TOLERANCE_PX = 8
const SNAP_TOLERANCE_PX = 12
const DRAG_THRESHOLD_PX = 3

const round1 = (v: number) => Math.round(v * 10) / 10
const roundPoint = ([x, y]: Point): Point => [round1(x), round1(y)]
const degrees = (radians: number) => Math.round((normalizeAngle(radians) * 180) / Math.PI)

/** Ende der Wand, die gerade gezeichnet wird, mit Einrasten an freien Wandenden. */
function wallEnd(home: Home, chain: WallChain, point: Point, magnetism: boolean, scale: number): { point: Point; join: WallEndSnap | null } {
  if (!magnetism) return { point: roundPoint(point), join: null }
  const exclude = new Set(chain.previousId ? [chain.previousId] : [])
  const join = snapToFreeWallEnd(home, point, SNAP_TOLERANCE_PX / scale, exclude)
  return join ? { point: join.point, join } : { point: magnetizeWallEnd(chain.start, point, scale), join: null }
}

/**
 * Punkt einer neuen Maßlinie: rastet an Wand- und Raumecken ein, sonst wie Wände in
 * 15°-Schritten zum Startpunkt.
 */
function dimensionPoint(home: Home, start: Point | null, point: Point, magnetism: boolean, scale: number): Point {
  if (!magnetism) return roundPoint(point)
  const snapped = snapToPoints(point, roomSnapPoints(home), SNAP_TOLERANCE_PX / scale)
  if (snapped !== point) return roundPoint(snapped)
  return start ? magnetizeWallEnd(start, point, scale) : roundPoint(point)
}

/**
 * Tür bzw. Fenster an einer Wand einrasten, sonst als Dachfenster auf einem Dach; ein Dachfenster, das
 * keines mehr ist, steht wieder aufrecht in der Höhe aus dem Katalog.
 */
function snapDoorOrWindow(home: Home, piece: HomePiece): Partial<HomePiece> | null {
  const upright = piece.roofId || piece.pitch ? { pitch: 0, roofId: null, elevation: useCatalogStore.getState().findPiece(piece.catalogId ?? '')?.elevation ?? 0 } : null
  const wall = snapDoorOrWindowToWall(home, piece)
  if (wall) return { ...wall, ...upright }
  return skylightPlacement(home, piece) ?? upright
}

/** Befehl, den eine Mausaktion beim Loslassen ausführt (und der vorher als Vorschau dient). */
function gestureCommand(home: Home, gesture: Gesture, scale: number): HomeCommand | null {
  if (gesture.kind === 'move') {
    const dx = round1(gesture.current[0] - gesture.start[0])
    const dy = round1(gesture.current[1] - gesture.start[1])
    if (dx === 0 && dy === 0) return null
    const piece = gesture.ids.length === 1 ? home.furniture.find((p) => p.id === gesture.ids[0]) : undefined
    if (piece?.doorOrWindowInfo && gesture.magnetism) {
      const x = piece.x + dx
      const y = piece.y + dy
      const snapped = snapDoorOrWindow(home, { ...piece, x, y })
      if (snapped) return { type: 'updateFurniture', changes: [{ id: piece.id, x, y, ...snapped }] }
    }
    return { type: 'moveItems', ids: gesture.ids, dx, dy }
  }
  if (gesture.kind === 'compass') {
    const dx = round1(gesture.current[0] - gesture.start[0])
    const dy = round1(gesture.current[1] - gesture.start[1])
    if (dx === 0 && dy === 0) return null
    return { type: 'updateCompass', change: { x: round1(home.compass.x + dx), y: round1(home.compass.y + dy) } }
  }
  if (gesture.kind !== 'handle') return null
  const { handle, current, magnetism } = gesture
  switch (handle.kind) {
    case 'rotate': {
      const { piece } = handle
      const [cornerX, cornerY] = [-piece.width / 2, -piece.depth / 2]
      const angle = Math.atan2(current[1] - piece.y, current[0] - piece.x) - Math.atan2(cornerY, cornerX)
      return { type: 'updateFurniture', changes: [{ id: piece.id, angle: normalizeAngle(magnetism ? snapAngle(angle) : angle) }] }
    }
    case 'resize': {
      const { piece } = handle
      if (!piece.width) return null
      // Die gegenüberliegende Ecke (links oben) bleibt fest
      const [lx, ly] = toPieceLocal(piece, current)
      const width = Math.max(1, round1(lx + piece.width / 2))
      const depth = Math.max(1, round1(ly + piece.depth / 2))
      const cx = -piece.width / 2 + width / 2
      const cy = -piece.depth / 2 + depth / 2
      const cos = Math.cos(piece.angle)
      const sin = Math.sin(piece.angle)
      const change: Partial<HomePiece> & { id: string } = {
        id: piece.id,
        width,
        depth,
        x: round1(piece.x + cx * cos - cy * sin),
        y: round1(piece.y + cx * sin + cy * cos),
      }
      return { type: 'updateFurniture', changes: [change] }
    }
    case 'dimensionStart':
    case 'dimensionEnd': {
      // Der Griff sitzt auf der verschobenen Linie: den gemessenen Punkt um den Abstand zurückrechnen
      const { line } = handle
      const angle = Math.atan2(line.yEnd - line.yStart, line.xEnd - line.xStart)
      const measured: Point = [current[0] + Math.sin(angle) * line.offset, current[1] - Math.cos(angle) * line.offset]
      const fixed: Point = handle.kind === 'dimensionStart' ? [line.xEnd, line.yEnd] : [line.xStart, line.yStart]
      const snapped = magnetism ? snapToPoints(measured, roomSnapPoints(home), SNAP_TOLERANCE_PX / scale) : measured
      const point = snapped === measured && magnetism ? magnetizeWallEnd(fixed, measured, scale) : roundPoint(snapped)
      const change =
        handle.kind === 'dimensionStart' ? { id: line.id, xStart: point[0], yStart: point[1] } : { id: line.id, xEnd: point[0], yEnd: point[1] }
      return { type: 'updateDimensionLines', changes: [change] }
    }
    case 'dimensionOffset': {
      const { line } = handle
      const offset = round1(signedOffset([line.xStart, line.yStart], [line.xEnd, line.yEnd], current))
      return { type: 'updateDimensionLines', changes: [{ id: line.id, offset }] }
    }
    case 'roofPoint':
    case 'roofMid': {
      const { roof, index } = handle
      if (handle.kind === 'roofMid') {
        // Nur beim Ziehen eine Ecke einfügen, nicht schon beim Klick auf den Griff
        const a = roof.points[index]
        const b = roof.points[(index + 1) % roof.points.length]
        if (distance(current, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) < DRAG_THRESHOLD_PX / scale) return null
      }
      const others = roof.points.filter((_, i) => handle.kind === 'roofMid' || i !== index)
      const snapped = magnetism ? snapToPoints(current, [...roomSnapPoints(home), ...others], SNAP_TOLERANCE_PX / scale) : current
      const point = roundPoint(snapped)
      if (handle.kind === 'roofPoint') {
        return { type: 'updateRoofs', changes: [{ id: roof.id, points: roof.points.map((p, i) => (i === index ? point : p)) }] }
      }
      // Neue Ecke in der Kante: beide Hälften behalten die Einstellungen der Kante
      const points = [...roof.points.slice(0, index + 1), point, ...roof.points.slice(index + 1)]
      const edges = [...roof.edges.slice(0, index + 1), { ...roof.edges[index] }, ...roof.edges.slice(index + 1)]
      return { type: 'updateRoofs', changes: [{ id: roof.id, points, edges }] }
    }
    case 'wallStart':
    case 'wallEnd': {
      const { wall } = handle
      const atStart = handle.kind === 'wallStart'
      const fixed: Point = atStart ? [wall.xEnd, wall.yEnd] : [wall.xStart, wall.yStart]
      const free = (atStart ? wall.wallAtStart : wall.wallAtEnd) === null
      const join = magnetism && free ? snapToFreeWallEnd(home, current, SNAP_TOLERANCE_PX / scale, new Set([wall.id])) : null
      const point = join?.point ?? (magnetism ? magnetizeWallEnd(fixed, current, scale) : roundPoint(current))
      const move = moveWallEndCommand(home, wall, atStart, point)
      if (!join?.wall) return move
      // Auf ein freies Wandende gezogen: beide Wände verbinden
      return {
        type: 'batch',
        commands: [
          move,
          {
            type: 'updateWalls',
            changes: [
              atStart ? { id: wall.id, wallAtStart: join.wall.id } : { id: wall.id, wallAtEnd: join.wall.id },
              join.atStart ? { id: join.wall.id, wallAtStart: wall.id } : { id: join.wall.id, wallAtEnd: wall.id },
            ],
          },
        ],
      }
    }
  }
}

/** Hinweistext am Mauszeiger während einer Aktion. */
function gestureLabel(preview: Home, gesture: Gesture): string | null {
  if (gesture.kind === 'handle') {
    const { handle } = gesture
    if ('line' in handle) {
      const line = preview.dimensionLines.find((d) => d.id === handle.line.id)
      if (!line) return null
      return handle.kind === 'dimensionOffset' ? `${line.offset} cm` : `${round1(dimensionLength(line))} cm`
    }
    if ('roof' in handle) return null
    const id = 'piece' in handle ? handle.piece.id : handle.wall.id
    const piece = preview.furniture.find((p) => p.id === id)
    const wall = preview.walls.find((w) => w.id === id)
    if (gesture.handle.kind === 'rotate' && piece) return `${degrees(piece.angle)}°`
    if (gesture.handle.kind === 'resize' && piece) return `${piece.width} × ${piece.depth} cm`
    if (wall) return `${round1(wallLength(wall))} cm`
  }
  if (gesture.kind === 'move') {
    return `Δ ${round1(gesture.current[0] - gesture.start[0])} / ${round1(gesture.current[1] - gesture.start[1])} cm`
  }
  return null
}

function cursorFor(handle: Handle | null, overItem: boolean): string {
  if (handle?.kind === 'rotate') return 'grab'
  if (handle?.kind === 'resize') return 'nwse-resize'
  if (handle) return 'crosshair'
  return overItem ? 'move' : 'default'
}

/**
 * Interaktiver 2D-Plan. Die Bedienung folgt Sweet Home 3D: Auswahl mit Rahmen, Verschieben,
 * Griffe zum Drehen/Skalieren bzw. für Wandenden, Wände als Kette zeichnen (Doppelklick oder Esc
 * beendet), Räume per Klickpunkten oder Doppelklick in einen umschlossenen Bereich.
 * Mausrad zoomt, mittlere Maustaste oder Leertaste + Ziehen verschiebt die Ansicht,
 * Alt schaltet den Magnetismus vorübergehend aus.
 */
export function PlanCanvas({ onStatus }: { onStatus: (status: { cursor: Point | null; hint: string }) => void }) {
  const { t } = useTranslation()
  const fullHome = useEditorStore((s) => s.home)!
  // Der Plan zeigt und bearbeitet nur die gewählte Ebene. Die Listen bleiben bei reinen
  // Kamerabewegungen dieselben, damit der Plan dann nur den Besucher neu zeichnet.
  const levelId = fullHome.levels.length > 0 ? fullHome.selectedLevel : undefined
  const walls = useMemo(() => onLevel(fullHome.walls, levelId), [fullHome.walls, levelId])
  const rooms = useMemo(() => onLevel(fullHome.rooms, levelId), [fullHome.rooms, levelId])
  const roofs = useMemo(() => onLevel(fullHome.roofs, levelId), [fullHome.roofs, levelId])
  const furniture = useMemo(() => onLevel(fullHome.furniture, levelId), [fullHome.furniture, levelId])
  const dimensionLines = useMemo(() => onLevel(fullHome.dimensionLines, levelId), [fullHome.dimensionLines, levelId])
  const labels = useMemo(() => onLevel(fullHome.labels, levelId), [fullHome.labels, levelId])
  const home = useMemo(
    () => ({ ...fullHome, walls, rooms, roofs, furniture, dimensionLines, labels }),
    [fullHome, walls, rooms, roofs, furniture, dimensionLines, labels],
  )
  const belowId = levelBelow(fullHome)?.id
  const wallsBelow = useMemo(() => (belowId ? fullHome.walls.filter((w) => w.level === belowId) : undefined), [fullHome.walls, belowId])
  // Dächer tieferer Ebenen, die in diese reichen: blass, mit der Linie 1 m über dem Boden (Kniestock)
  const roofsBelow = useMemo(() => {
    const level = fullHome.levels.find((l) => l.id === fullHome.selectedLevel)
    if (!level) return undefined
    return fullHome.roofs
      .filter((roof) => roof.visible && roof.level !== level.id && levelElevation(fullHome, roof.level) < level.elevation)
      .map((roof) => {
        const model = rawRoofModel(fullHome, roof)
        const floor = level.elevation - levelElevation(fullHome, roof.level)
        return { roof, model, contour: roofContour(model, floor + 100), floor }
      })
      .filter(({ model, floor }) => model.ridge > floor)
  }, [fullHome])
  const selection = useEditorStore((s) => s.selection)
  const { mode, magnetism, view, setView, fitRequest } = usePlanStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [pointer, setPointer] = useState<{ point: Point; alt: boolean } | null>(null)
  const [chain, setChain] = useState<WallChain | null>(null)
  const [roomPoints, setRoomPoints] = useState<Point[]>([])
  const [roofPoints, setRoofPoints] = useState<Point[]>([])
  const [roofMenu, setRoofMenu] = useState<RoofMenuTarget | null>(null)
  const [dimension, setDimension] = useState<DimensionDraft | null>(null)
  const [cursorStyle, setCursorStyle] = useState('default')
  const spaceHeld = useRef(false)
  const hovered = useRef(false)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const fittedFor = useRef(0)
  const { scale } = view

  useEffect(() => {
    const element = containerRef.current!
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (size.width === 0 || size.height === 0) return
    const bounds = homeBounds(homeOnLevel(useEditorStore.getState().home!)) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
    const padding = 40
    const width = Math.max(bounds.maxX - bounds.minX, 200)
    const height = Math.max(bounds.maxY - bounds.minY, 200)
    const fitScale = Math.min((size.width - 2 * padding) / width, (size.height - 2 * padding) / height)
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    setView({ scale: fitScale, x: size.width / 2 - centerX * fitScale, y: size.height / 2 - centerY * fitScale })
  }, [size, setView])

  // Beim ersten Anzeigen und auf Anforderung („Alles zeigen“) den ganzen Plan einpassen
  useEffect(() => {
    if (size.width > 0 && fittedFor.current !== fitRequest) {
      fittedFor.current = fitRequest
      fit()
    }
  }, [fit, fitRequest, size.width])

  // Werkzeugwechsel bricht angefangene Wände/Räume ab
  useEffect(
    () =>
      usePlanStore.subscribe((state, previous) => {
        if (state.mode !== previous.mode) {
          setChain(null)
          setRoomPoints([])
          setRoofPoints([])
          setDimension(null)
        }
      }),
    [],
  )

  const toPlan = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current!.getBoundingClientRect()
      return [(clientX - rect.left - view.x) / view.scale, (clientY - rect.top - view.y) / view.scale]
    },
    [view],
  )

  // Zoomen mit dem Mausrad (nicht passiv, damit die Seite nicht scrollt)
  useEffect(() => {
    const element = containerRef.current!
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const factor = Math.pow(1.0015, -event.deltaY)
      setView(zoomAt(usePlanStore.getState().view, factor, event.clientX - rect.left, event.clientY - rect.top))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [setView])

  const finishRoom = useCallback(
    (points: Point[]) => {
      // Doppelte Punkte (z. B. vom Doppelklick) entfernen
      const unique = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 0.5)
      if (unique.length > 2 && distance(unique[0], unique.at(-1)!) < 0.5) unique.pop()
      if (unique.length >= 3) {
        const room = { id: newId('room'), name: null, points: unique, floorVisible: true, ceilingVisible: true, level: null }
        executeCommand({ type: 'addItems', rooms: [room] })
        dispatch({ type: 'select', ids: [room.id] })
      }
      setRoomPoints([])
    },
    [],
  )

  /** Legt ein Dach über den Umriss an; {@code walls}: Wände darunter, deren Oberkante dem Dach folgt. */
  const addRoof = useCallback((outline: Point[], walls: Wall[] = []) => {
    const level = useEditorStore.getState().home!.selectedLevel
    const roof = createRoof(outline, level)
    const under = wallsUnderRoofEdge(walls, roof)
    const add: HomeCommand = { type: 'addItems', roofs: [roof] }
    executeCommand(under.length > 0 ? { type: 'batch', commands: [add, { type: 'updateWalls', changes: under.map((w) => ({ id: w.id, toRoof: true })) }] } : add)
    dispatch({ type: 'select', ids: [roof.id] })
  }, [])

  const finishRoof = useCallback(
    (points: Point[]) => {
      const unique = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 0.5)
      if (unique.length > 2 && distance(unique[0], unique.at(-1)!) < 0.5) unique.pop()
      if (unique.length >= 3) addRoof(unique)
      setRoofPoints([])
    },
    [addRoof],
  )

  // Tastatur: Esc bricht ab, Enter beendet einen Raum, Leertaste zum Verschieben der Ansicht
  useEffect(() => {
    const isInput = (event: KeyboardEvent) => (event.target as HTMLElement | null)?.closest('input, textarea') != null
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDialogOpen()) return
      const space = event.code === 'Space' || event.key === ' '
      // Steht die Maus über dem Plan, gehört die Leertaste ihm, auch wenn noch das Suchfeld
      // oder ein Knopf den Fokus hat (sonst tippt sie dort bzw. löst den Knopf aus)
      if (space && hovered.current) {
        if (document.activeElement !== containerRef.current) containerRef.current?.focus()
        spaceHeld.current = true
        event.preventDefault()
        return
      }
      if (isInput(event)) return
      if (space) {
        spaceHeld.current = true
        event.preventDefault()
      } else if (event.key === 'Escape') {
        setGesture(null)
        setChain(null)
        setRoomPoints([])
        setRoofPoints([])
        setDimension(null)
      } else if (event.key === 'Enter' && roomPoints.length > 0) {
        finishRoom(roomPoints)
      } else if (event.key === 'Enter' && roofPoints.length > 0) {
        finishRoof(roofPoints)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') spaceHeld.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [roomPoints, finishRoom, roofPoints, finishRoof])

  const onPointerDown = (event: React.PointerEvent) => {
    containerRef.current!.focus()
    const point = toPlan(event.clientX, event.clientY)
    const magnet = magnetism !== event.altKey
    if (event.button === 1 || (event.button === 0 && (mode === 'pan' || spaceHeld.current))) {
      event.currentTarget.setPointerCapture(event.pointerId)
      setGesture({ kind: 'pan', startX: event.clientX, startY: event.clientY, view })
      return
    }
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pressStart.current = { x: event.clientX, y: event.clientY }

    if (mode === 'select') {
      const observerPart = hitObserver(home, point, HANDLE_TOLERANCE_PX / scale)
      if (observerPart) {
        setGesture({ kind: 'observer', part: observerPart, start: point, camera: home.camera.observer })
        return
      }
      const handle = hitHandle(home, selection, point, HANDLE_TOLERANCE_PX / scale)
      if (handle) {
        setGesture({ kind: 'handle', handle, current: point, magnetism: magnet })
        return
      }
      const hit = hitItem(home, point, HANDLE_TOLERANCE_PX / scale)
      if (hit && event.shiftKey) {
        dispatch({ type: 'select', ids: selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id] })
      } else if (hit) {
        const ids = selection.includes(hit.id) ? selection : [hit.id]
        if (!selection.includes(hit.id)) dispatch({ type: 'select', ids })
        setGesture({ kind: 'move', start: point, current: point, ids, magnetism: magnet })
      } else if (!event.shiftKey && hitCompass(home, point, scale, HANDLE_TOLERANCE_PX / scale)) {
        if (selection.length > 0) dispatch({ type: 'select', ids: [] })
        setGesture({ kind: 'compass', start: point, current: point })
      } else {
        if (!event.shiftKey && selection.length > 0) dispatch({ type: 'select', ids: [] })
        setGesture({ kind: 'rubberBand', start: point, current: point, base: event.shiftKey ? selection : [] })
      }
    } else if (mode === 'wall') {
      if (!chain) {
        const join = magnet ? snapToFreeWallEnd(home, point, SNAP_TOLERANCE_PX / scale) : null
        setChain({ start: join?.point ?? roundPoint(point), join, previousId: null })
        return
      }
      // Zweiter Klick eines Doppelklicks: keine Mini-Wand anlegen
      if (distance(chain.start, point) < DRAG_THRESHOLD_PX / scale) return
      const end = wallEnd(home, chain, point, magnet, scale)
      if (distance(chain.start, end.point) < 1) return
      const { command, wall } = createWallCommand(chain.start, end.point, chain.join, end.join)
      executeCommand(command)
      // Auf ein freies Wandende getroffen (z. B. Kette geschlossen): Kette beenden
      setChain(end.join ? null : { start: end.point, join: { point: end.point, wall, atStart: false }, previousId: wall.id })
    } else if (mode === 'room') {
      const snapped = magnet ? snapToPoints(point, roomSnapPoints(home), SNAP_TOLERANCE_PX / scale) : point
      setRoomPoints((points) => [...points, roundPoint(snapped)])
    } else if (mode === 'roof') {
      const snapped = magnet ? snapToPoints(point, [...roomSnapPoints(home), ...home.roofs.flatMap((r) => r.points)], SNAP_TOLERANCE_PX / scale) : point
      setRoofPoints((points) => [...points, roundPoint(snapped)])
    } else if (mode === 'dimension') {
      if (!dimension) {
        setDimension({ start: dimensionPoint(home, null, point, magnet, scale), end: null })
      } else if (!dimension.end) {
        const end = dimensionPoint(home, dimension.start, point, magnet, scale)
        if (distance(dimension.start, end) >= 1) setDimension({ start: dimension.start, end })
      } else {
        const line: DimensionLine = {
          id: newId('dimensionLine'),
          xStart: dimension.start[0],
          yStart: dimension.start[1],
          xEnd: dimension.end[0],
          yEnd: dimension.end[1],
          offset: round1(signedOffset(dimension.start, dimension.end, point)),
          level: null,
        }
        executeCommand({ type: 'addItems', dimensionLines: [line] })
        dispatch({ type: 'select', ids: [line.id] })
        setDimension(null)
      }
    } else if (mode === 'label') {
      const [x, y] = roundPoint(point)
      useDialogStore.getState().open({ kind: 'newLabel', x, y })
    }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    hovered.current = true
    const point = toPlan(event.clientX, event.clientY)
    setPointer({ point, alt: event.altKey })
    if (!gesture) {
      if (mode === 'select' && !spaceHeld.current) {
        const observerPart = hitObserver(home, point, HANDLE_TOLERANCE_PX / scale)
        const handle = hitHandle(home, selection, point, HANDLE_TOLERANCE_PX / scale)
        const overItem = hitItem(home, point, HANDLE_TOLERANCE_PX / scale) !== null || hitCompass(home, point, scale, HANDLE_TOLERANCE_PX / scale)
        setCursorStyle(observerPart === 'rotate' ? 'grab' : observerPart ? 'move' : cursorFor(handle, overItem))
      } else {
        setCursorStyle(mode === 'pan' || spaceHeld.current ? 'grab' : 'crosshair')
      }
      return
    }
    if (gesture.kind === 'pan') {
      setCursorStyle('grabbing')
      setView({ ...gesture.view, x: gesture.view.x + event.clientX - gesture.startX, y: gesture.view.y + event.clientY - gesture.startY })
      return
    }
    if (gesture.kind === 'observer') {
      // Besucher live bewegen, damit die 3D-Ansicht (auch in anderen Fenstern) mitläuft
      const { camera, start, part } = gesture
      const observer =
        part === 'move'
          ? { x: round1(camera.x + point[0] - start[0]), y: round1(camera.y + point[1] - start[1]) }
          : { yaw: magnetism !== event.altKey ? snapAngle(Math.atan2(point[1] - camera.y, point[0] - camera.x)) : Math.atan2(point[1] - camera.y, point[0] - camera.x) }
      dispatch({ type: 'camera', camera: { observer } })
      return
    }
    // Kleine Zitterbewegungen beim Klicken nicht als Verschieben werten
    const start = pressStart.current
    if ((gesture.kind === 'move' || gesture.kind === 'compass') && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD_PX) return
    const magnet = magnetism !== event.altKey
    setGesture(gesture.kind === 'rubberBand' || gesture.kind === 'compass' ? { ...gesture, current: point } : { ...gesture, current: point, magnetism: magnet })
  }

  const onPointerUp = () => {
    pressStart.current = null
    if (!gesture) return
    if (gesture.kind === 'rubberBand') {
      const ids = itemsInRect(home, gesture.start, gesture.current)
      if (ids.length > 0 || gesture.base.length > 0) dispatch({ type: 'select', ids: [...new Set([...gesture.base, ...ids])] })
    } else {
      const command = gestureCommand(home, gesture, scale)
      if (command) executeCommand(command)
    }
    setGesture(null)
  }

  const onDoubleClick = (event: React.MouseEvent) => {
    if (mode === 'select') {
      const point = toPlan(event.clientX, event.clientY)
      const hit = hitItem(home, point, HANDLE_TOLERANCE_PX / scale)
      if (hit) openItemDialog(selection.includes(hit.id) ? selection : [hit.id])
      else if (hitCompass(home, point, scale, HANDLE_TOLERANCE_PX / scale)) openCompassDialog()
    } else if (mode === 'wall') {
      setChain(null)
    } else if (mode === 'roof') {
      const points = roofPoints.filter((p, i) => i === 0 || distance(p, roofPoints[i - 1]) > 0.5)
      setRoofPoints([])
      if (points.length >= 3) {
        finishRoof(roofPoints)
        return
      }
      const point = toPlan(event.clientX, event.clientY)
      // Doppelklick in ausgewählte Räume: Dach über ihre Vereinigung
      const selectedRooms = home.rooms.filter((r) => selection.includes(r.id))
      if (selectedRooms.some((r) => pointInPolygon(point, r.points))) {
        try {
          const polygons: Polygon[] = selectedRooms.map((r) => [[...r.points, r.points[0]]])
          const union = polygonClipping.union(polygons[0], ...polygons.slice(1))
          const part = union.find((p) => pointInPolygon(point, p[0].slice(0, -1) as Point[])) ?? union[0]
          if (part) addRoof(part[0].slice(0, -1) as Point[])
        } catch {
          // Ungültige Räume: kein Dach
        }
        return
      }
      // Doppelklick in ein Haus: Dach über den Außenumriss seiner Wände
      const outline = outlineFromWalls(home.walls, point)
      if (outline) {
        addRoof(outline.points, home.walls)
        return
      }
      const room = [...home.rooms].reverse().find((r) => pointInPolygon(point, r.points))
      if (room) addRoof(room.points)
    } else if (mode === 'room') {
      const points = roomPoints.filter((p, i) => i === 0 || distance(p, roomPoints[i - 1]) > 0.5)
      if (points.length >= 3) {
        finishRoom(roomPoints)
      } else {
        // Doppelklick in einen von Wänden umschlossenen Bereich legt dort einen Raum an
        setRoomPoints([])
        const detected = detectRoom(home, toPlan(event.clientX, event.clientY))
        if (detected) finishRoom(detected)
      }
    }
  }

  const onDrop = async (event: React.DragEvent) => {
    const catalogId = event.dataTransfer.getData(CATALOG_PIECE_MIME)
    if (!catalogId) return
    event.preventDefault()
    const point = roundPoint(toPlan(event.clientX, event.clientY))
    // Das Katalog-Panel kann in einem anderen Fenster liegen: Katalog hier ggf. nachladen
    const catalog = useCatalogStore.getState()
    await catalog.load(catalog.language ?? 'en')
    const catalogPiece = useCatalogStore.getState().findPiece(catalogId)
    if (!catalogPiece) return
    let piece = pieceFromCatalog(catalogPiece, point[0], point[1])
    const snapped = magnetism && piece.doorOrWindowInfo ? snapDoorOrWindow(home, { ...piece, level: home.selectedLevel }) : null
    if (snapped) piece = { ...piece, ...snapped }
    executeCommand({ type: 'addItems', furniture: [piece] })
    dispatch({ type: 'select', ids: [piece.id] })
  }

  // Vorschau: laufende Aktion auf eine Kopie des Projekts anwenden
  const pendingCommand = gesture ? gestureCommand(home, gesture, scale) : null
  const displayed = useMemo(
    () => (pendingCommand ? produce(home, (draft) => applyCommand(draft, pendingCommand)) : home),
    [home, pendingCommand],
  )

  const preview: PlanPreview = {}
  const magnetNow = magnetism !== (pointer?.alt ?? false)
  if (mode === 'wall' && chain && pointer) {
    const end = wallEnd(home, chain, pointer.point, magnetNow, scale)
    const wall: Wall = {
      id: 'preview',
      xStart: chain.start[0],
      yStart: chain.start[1],
      xEnd: end.point[0],
      yEnd: end.point[1],
      wallAtStart: null,
      wallAtEnd: null,
      thickness: DEFAULT_WALL_THICKNESS,
      height: null,
      level: null,
    }
    preview.wall = wall
    preview.label = { point: pointer.point, text: `${round1(wallLength(wall))} cm · ${degrees(-Math.atan2(wall.yEnd - wall.yStart, wall.xEnd - wall.xStart))}°` }
  }
  if (mode === 'room' && roomPoints.length > 0 && pointer) {
    const next = magnetNow ? snapToPoints(pointer.point, roomSnapPoints(home), SNAP_TOLERANCE_PX / scale) : pointer.point
    preview.roomPoints = [...roomPoints, next]
  }
  if (mode === 'roof' && roofPoints.length > 0 && pointer) {
    const next = magnetNow ? snapToPoints(pointer.point, [...roomSnapPoints(home), ...home.roofs.flatMap((r) => r.points)], SNAP_TOLERANCE_PX / scale) : pointer.point
    preview.roofPoints = [...roofPoints, next]
  }
  if (mode === 'dimension' && dimension && pointer) {
    const end = dimension.end ?? dimensionPoint(home, dimension.start, pointer.point, magnetNow, scale)
    const line: DimensionLine = {
      id: 'preview',
      xStart: dimension.start[0],
      yStart: dimension.start[1],
      xEnd: end[0],
      yEnd: end[1],
      offset: dimension.end ? round1(signedOffset(dimension.start, dimension.end, pointer.point)) : 0,
      level: null,
    }
    preview.dimensionLine = line
    preview.label = { point: pointer.point, text: `${round1(dimensionLength(line))} cm` }
  }
  if (gesture?.kind === 'rubberBand') preview.rubberBand = [gesture.start, gesture.current]
  if (gesture && pointer) {
    const text = gestureLabel(displayed, gesture)
    if (text) preview.label = { point: pointer.point, text }
  }

  // Statuszeile: Hinweis zum aktuellen Werkzeug und Mausposition
  const hint =
    mode === 'wall'
      ? t(chain ? 'plan.hints.wallNext' : 'plan.hints.wallStart')
      : mode === 'room'
        ? t(roomPoints.length > 0 ? 'plan.hints.roomNext' : 'plan.hints.roomStart')
        : mode === 'roof'
          ? t(roofPoints.length > 0 ? 'plan.hints.roofNext' : 'plan.hints.roofStart')
        : mode === 'dimension'
          ? t(!dimension ? 'plan.hints.dimensionStart' : !dimension.end ? 'plan.hints.dimensionEnd' : 'plan.hints.dimensionOffset')
          : mode === 'label'
            ? t('plan.hints.label')
            : mode === 'pan'
              ? t('plan.hints.pan')
          : t(handlePoints(home, selection).length > 0 ? 'plan.hints.selectHandles' : 'plan.hints.select')
  const cursorPoint = pointer?.point ?? null
  useEffect(() => {
    onStatus({ cursor: cursorPoint, hint })
  }, [cursorPoint, hint, onStatus])

  return (
    <Box
      ref={containerRef}
      tabIndex={0}
      sx={{ position: 'absolute', inset: 0, outline: 'none', bgcolor: 'background.default', cursor: cursorStyle, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setGesture(null)}
      onPointerLeave={() => {
        hovered.current = false
        if (!gesture) setPointer(null)
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        // Rechtsklick an einer Ecke oder Kante des ausgewählten Dachs: Kantentyp bzw. Ecke löschen
        const roof = selection.length === 1 ? home.roofs.find((r) => r.id === selection[0]) : undefined
        if (!roof || mode !== 'select') return
        const point = toPlan(e.clientX, e.clientY)
        const tolerance = HANDLE_TOLERANCE_PX / scale
        const corner = roof.points.findIndex((p) => distance(p, point) <= tolerance)
        if (corner >= 0) {
          setRoofMenu({ x: e.clientX, y: e.clientY, roofId: roof.id, kind: 'point', index: corner })
          return
        }
        const n = roof.points.length
        let best = -1
        let bestDistance = tolerance * 2
        roof.points.forEach((a, i) => {
          const d = distanceToSegment(point, a, roof.points[(i + 1) % n])
          if (d < bestDistance) {
            best = i
            bestDistance = d
          }
        })
        if (best >= 0) setRoofMenu({ x: e.clientX, y: e.clientY, roofId: roof.id, kind: 'edge', index: best })
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(CATALOG_PIECE_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => void onDrop(e)}
      data-testid="plan-canvas"
    >
      {size.width > 0 && (
        <Stage width={size.width} height={size.height} scaleX={scale} scaleY={scale} x={view.x} y={view.y} listening={false}>
          <Layer listening={false}>
            <PlanRenderer
              home={displayed}
              selection={selection}
              view={view}
              width={size.width}
              height={size.height}
              preview={preview}
              wallsBelow={wallsBelow}
              roofsBelow={roofsBelow}
            />
          </Layer>
        </Stage>
      )}
      {roofMenu && <RoofEdgeMenu target={roofMenu} onClose={() => setRoofMenu(null)} />}
    </Box>
  )
}
