import Box from '@mui/material/Box'
import { produce } from 'immer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Stage } from 'react-konva'
import { useTranslation } from 'react-i18next'
import { CATALOG_PIECE_MIME, useCatalogStore } from '../catalog/catalogStore'
import { applyCommand, type HomeCommand } from '../model/commands'
import { pieceFromCatalog } from '../model/furniture'
import { distance, toPieceLocal, wallLength, type Point } from '../model/geometry'
import { newId, type Home, type HomePiece, type Wall } from '../model/home'
import { dispatch, executeCommand, useEditorStore } from '../store/editorStore'
import { handlePoints, hitHandle, hitItem, homeBounds, itemsInRect, type Handle } from './hitTest'
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
import { usePlanStore, zoomAt, type PlanView } from './planStore'
import { detectRoom } from './roomDetection'
import { createWallCommand, DEFAULT_WALL_THICKNESS, moveWallEndCommand } from './wallEditing'

/** Laufende Mausaktion im Plan. */
type Gesture =
  | { kind: 'pan'; startX: number; startY: number; view: PlanView }
  | { kind: 'rubberBand'; start: Point; current: Point; base: string[] }
  | { kind: 'move'; start: Point; current: Point; ids: string[]; magnetism: boolean }
  | { kind: 'handle'; handle: Handle; current: Point; magnetism: boolean }

/** Wandkette im Wand-Modus: Startpunkt der nächsten Wand und woran sie anschließt. */
interface WallChain {
  start: Point
  join: WallEndSnap | null
  /** Zuletzt gezeichnete Wand, deren freies Ende am Startpunkt liegt. */
  previousId: string | null
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

/** Befehl, den eine Mausaktion beim Loslassen ausführt (und der vorher als Vorschau dient). */
function gestureCommand(home: Home, gesture: Gesture, scale: number): HomeCommand | null {
  if (gesture.kind === 'move') {
    const dx = round1(gesture.current[0] - gesture.start[0])
    const dy = round1(gesture.current[1] - gesture.start[1])
    if (dx === 0 && dy === 0) return null
    const piece = gesture.ids.length === 1 ? home.furniture.find((p) => p.id === gesture.ids[0]) : undefined
    if (piece?.doorOrWindowInfo && gesture.magnetism) {
      const snapped = snapDoorOrWindowToWall(home, { ...piece, x: piece.x + dx, y: piece.y + dy })
      if (snapped) return { type: 'updateFurniture', changes: [{ id: piece.id, ...snapped }] }
    }
    return { type: 'moveItems', ids: gesture.ids, dx, dy }
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
    const id = 'piece' in gesture.handle ? gesture.handle.piece.id : gesture.handle.wall.id
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
  const home = useEditorStore((s) => s.home)!
  const selection = useEditorStore((s) => s.selection)
  const { mode, magnetism, view, setView, fitRequest } = usePlanStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [pointer, setPointer] = useState<{ point: Point; alt: boolean } | null>(null)
  const [chain, setChain] = useState<WallChain | null>(null)
  const [roomPoints, setRoomPoints] = useState<Point[]>([])
  const [cursorStyle, setCursorStyle] = useState('default')
  const spaceHeld = useRef(false)
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
    const bounds = homeBounds(useEditorStore.getState().home!) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
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
        const room = { id: newId('room'), name: null, points: unique, floorVisible: true, ceilingVisible: true }
        executeCommand({ type: 'addItems', rooms: [room] })
        dispatch({ type: 'select', ids: [room.id] })
      }
      setRoomPoints([])
    },
    [],
  )

  // Tastatur: Esc bricht ab, Enter beendet einen Raum, Leertaste zum Verschieben der Ansicht
  useEffect(() => {
    const isInput = (event: KeyboardEvent) => (event.target as HTMLElement | null)?.closest('input, textarea') != null
    const onKeyDown = (event: KeyboardEvent) => {
      if (isInput(event)) return
      if (event.key === ' ') {
        spaceHeld.current = true
        event.preventDefault()
      } else if (event.key === 'Escape') {
        setGesture(null)
        setChain(null)
        setRoomPoints([])
      } else if (event.key === 'Enter' && roomPoints.length > 0) {
        finishRoom(roomPoints)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') spaceHeld.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [roomPoints, finishRoom])

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
      const handle = hitHandle(home, selection, point, HANDLE_TOLERANCE_PX / scale)
      if (handle) {
        setGesture({ kind: 'handle', handle, current: point, magnetism: magnet })
        return
      }
      const hit = hitItem(home, point)
      if (hit && event.shiftKey) {
        dispatch({ type: 'select', ids: selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id] })
      } else if (hit) {
        const ids = selection.includes(hit.id) ? selection : [hit.id]
        if (!selection.includes(hit.id)) dispatch({ type: 'select', ids })
        setGesture({ kind: 'move', start: point, current: point, ids, magnetism: magnet })
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
    }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const point = toPlan(event.clientX, event.clientY)
    setPointer({ point, alt: event.altKey })
    if (!gesture) {
      if (mode === 'select' && !spaceHeld.current) {
        const handle = hitHandle(home, selection, point, HANDLE_TOLERANCE_PX / scale)
        setCursorStyle(cursorFor(handle, hitItem(home, point) !== null))
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
    // Kleine Zitterbewegungen beim Klicken nicht als Verschieben werten
    const start = pressStart.current
    if (gesture.kind === 'move' && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD_PX) return
    const magnet = magnetism !== event.altKey
    setGesture(gesture.kind === 'rubberBand' ? { ...gesture, current: point } : { ...gesture, current: point, magnetism: magnet })
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
    if (mode === 'wall') {
      setChain(null)
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
    await catalog.load(catalog.language ?? 'de')
    const catalogPiece = useCatalogStore.getState().findPiece(catalogId)
    if (!catalogPiece) return
    let piece = pieceFromCatalog(catalogPiece, point[0], point[1])
    const snapped = magnetism ? snapDoorOrWindowToWall(home, piece) : null
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
    }
    preview.wall = wall
    preview.label = { point: pointer.point, text: `${round1(wallLength(wall))} cm · ${degrees(-Math.atan2(wall.yEnd - wall.yStart, wall.xEnd - wall.xStart))}°` }
  }
  if (mode === 'room' && roomPoints.length > 0 && pointer) {
    const next = magnetNow ? snapToPoints(pointer.point, roomSnapPoints(home), SNAP_TOLERANCE_PX / scale) : pointer.point
    preview.roomPoints = [...roomPoints, next]
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
      onPointerLeave={() => !gesture && setPointer(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
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
            <PlanRenderer home={displayed} selection={selection} view={view} width={size.width} height={size.height} preview={preview} />
          </Layer>
        </Stage>
      )}
    </Box>
  )
}
