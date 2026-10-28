import { useTheme } from '@mui/material/styles'
import { useMemo } from 'react'
import { Circle, Group, Image, Label, Line, Rect, Shape, Tag, Text } from 'react-konva'
import type { Home, HomePiece, ObserverCamera, Wall } from '../model/home'
import { polygonArea, polygonCentroid, wallPolygon, type Point } from '../model/geometry'
import { handlePoints, observerHandle, OBSERVER_RADIUS } from './hitTest'
import type { PlanView } from './planStore'
import { useResolvedRef } from '../storage/contents'
import { useImage } from './useImage'

export interface PlanPreview {
  /** Wand, die gerade gezeichnet wird. */
  wall?: Wall
  /** Punkte des Raums, der gerade gezeichnet wird (inkl. Mauszeiger). */
  roomPoints?: Point[]
  rubberBand?: [Point, Point]
  /** Hinweis am Mauszeiger, z. B. Länge und Winkel der Wand. */
  label?: { point: Point; text: string }
}

interface PlanRendererProps {
  home: Home
  selection: string[]
  view: PlanView
  width: number
  height: number
  preview: PlanPreview
}

const flat = (points: Point[]) => points.flat()

/** Schraffur für Wände, wie in Sweet Home 3D. */
function useHatchPattern(color: string, background: string): HTMLCanvasElement {
  return useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 8, 8)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, 8)
    ctx.lineTo(8, 0)
    ctx.moveTo(-1, 1)
    ctx.lineTo(1, -1)
    ctx.moveTo(7, 9)
    ctx.lineTo(9, 7)
    ctx.stroke()
    return canvas
  }, [color, background])
}

function Grid({ view, width, height, minor, major }: { view: PlanView; width: number; height: number; minor: string; major: string }) {
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        const { scale } = view
        // Rasterweite so wählen, dass Linien mindestens 8 px auseinander liegen
        const step = [10, 50, 100, 500, 1000, 5000].find((s) => s * scale >= 8) ?? 10000
        const majorStep = step * (step === 50 || step === 500 ? 2 : 10)
        const x0 = Math.floor(-view.x / scale / step) * step
        const y0 = Math.floor(-view.y / scale / step) * step
        const x1 = (width - view.x) / scale
        const y1 = (height - view.y) / scale
        for (const [color, every] of [[minor, step], [major, majorStep]] as const) {
          ctx.beginPath()
          for (let x = Math.floor(x0 / every) * every; x <= x1; x += every) {
            ctx.moveTo(x, y0)
            ctx.lineTo(x, y1)
          }
          for (let y = Math.floor(y0 / every) * every; y <= y1; y += every) {
            ctx.moveTo(x0, y)
            ctx.lineTo(x1, y)
          }
          ctx.strokeStyle = color
          ctx.lineWidth = 1 / scale
          ctx.stroke()
        }
      }}
    />
  )
}

function PieceShape({ piece, scale, stroke, selected, selectedColor }: { piece: HomePiece; scale: number; stroke: string; selected: boolean; selectedColor: string }) {
  const image = useImage(useResolvedRef(piece.planIcon ?? piece.icon))
  const { width: w, depth: d } = piece
  // Symbol wie in Sweet Home 3D mit erhaltenem Seitenverhältnis einpassen
  const fit = image ? Math.min(w / image.width, d / image.height) : 0
  const iw = image ? image.width * fit : 0
  const ih = image ? image.height * fit : 0
  return (
    <Group x={piece.x} y={piece.y} rotation={(piece.angle * 180) / Math.PI} listening={false}>
      {image && <Image image={image} x={-iw / 2} y={-ih / 2} width={iw} height={ih} opacity={0.9} />}
      {piece.doorOrWindowInfo?.sashes.map((sash, i) => (
        <Shape
          key={i}
          sceneFunc={(ctx, shape) => {
            // Öffnungsbogen eines Flügels; die Achse liegt relativ zur linken Rückseite.
            // Winkel wie bei Java2D gegen den Uhrzeigersinn, daher für das Canvas (y nach unten) negiert
            const ax = -w / 2 + sash.xAxis * w
            const ay = -d / 2 + sash.yAxis * d
            const r = sash.width * w
            const start = -sash.startAngle
            const end = -sash.endAngle
            ctx.beginPath()
            ctx.moveTo(ax, ay)
            ctx.lineTo(ax + Math.cos(start) * r, ay + Math.sin(start) * r)
            ctx.arc(ax, ay, r, start, end, end < start)
            ctx.closePath()
            ctx.strokeShape(shape)
          }}
          stroke={stroke}
          strokeWidth={1 / scale}
          dash={[4 / scale, 3 / scale]}
        />
      ))}
      <Rect
        x={-w / 2}
        y={-d / 2}
        width={w}
        height={d}
        stroke={selected ? selectedColor : stroke}
        strokeWidth={(selected ? 3 : 1) / scale}
        shadowColor={selectedColor}
        shadowBlur={selected ? 6 : 0}
      />
    </Group>
  )
}

/** Virtueller Besucher: Kopf, Blickfeld und Drehgriff. */
function Observer({ observer, scale, color, paper }: { observer: ObserverCamera; scale: number; color: string; paper: string }) {
  const length = 150
  const half = observer.fieldOfView / 2
  const handle = observerHandle(observer)
  return (
    <Group listening={false}>
      <Line
        points={[
          observer.x,
          observer.y,
          observer.x + Math.cos(observer.yaw - half) * length,
          observer.y + Math.sin(observer.yaw - half) * length,
          observer.x + Math.cos(observer.yaw + half) * length,
          observer.y + Math.sin(observer.yaw + half) * length,
        ]}
        closed
        fill={color}
        opacity={0.18}
      />
      <Circle x={observer.x} y={observer.y} radius={OBSERVER_RADIUS} fill={color} stroke={paper} strokeWidth={2 / scale} />
      <Circle x={handle[0]} y={handle[1]} radius={5 / scale} fill={paper} stroke={color} strokeWidth={2 / scale} />
    </Group>
  )
}

/** Zeichnet den Plan in Plankoordinaten (cm); Linienbreiten und Schrift bleiben am Bildschirm konstant. */
export function PlanRenderer({ home, selection, view, width, height, preview }: PlanRendererProps) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const { scale } = view
  const ink = theme.palette.text.primary
  const selectedColor = theme.palette.primary.main
  const hatch = useHatchPattern(dark ? '#9aa0a6' : '#5f6368', dark ? '#3c4043' : '#e8eaed')
  const selected = useMemo(() => new Set(selection), [selection])
  const wallsById = useMemo(() => new Map(home.walls.map((w) => [w.id, w])), [home.walls])
  const fontSize = 12 / scale

  const wallShape = (wall: Wall, polygon: Point[], isSelected: boolean, dashed = false) => (
    <Line
      key={wall.id}
      points={flat(polygon)}
      closed
      fillPatternImage={hatch as unknown as HTMLImageElement}
      fillPatternScale={{ x: 1 / scale, y: 1 / scale }}
      stroke={isSelected ? selectedColor : ink}
      strokeWidth={(isSelected ? 3 : 1.2) / scale}
      shadowColor={selectedColor}
      shadowBlur={isSelected ? 6 : 0}
      dash={dashed ? [6 / scale, 4 / scale] : undefined}
      listening={false}
    />
  )

  return (
    <>
      <Grid
        view={view}
        width={width}
        height={height}
        minor={dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}
        major={dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}
      />

      {home.rooms.map((room) => {
        const [cx, cy] = polygonCentroid(room.points)
        const area = (polygonArea(room.points) / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 })
        const isSelected = selected.has(room.id)
        return (
          <Group key={room.id} listening={false}>
            <Line
              points={flat(room.points)}
              closed
              fill={dark ? 'rgba(144,202,249,0.10)' : 'rgba(25,118,210,0.07)'}
              stroke={isSelected ? selectedColor : theme.palette.text.secondary}
              strokeWidth={(isSelected ? 3 : 1) / scale}
            />
            <Text
              x={cx}
              y={cy}
              text={`${room.name ? `${room.name}\n` : ''}${area} m²`}
              fontSize={fontSize}
              fill={theme.palette.text.secondary}
              align="center"
              width={200 / scale}
              offsetX={100 / scale}
              offsetY={fontSize / 2}
            />
          </Group>
        )
      })}

      {home.walls.map((wall) => wallShape(wall, wallPolygon(wall, wallsById), selected.has(wall.id)))}

      {home.furniture
        .filter((p) => p.visible)
        .map((piece) => (
          <PieceShape
            key={piece.id}
            piece={piece}
            scale={scale}
            stroke={theme.palette.text.secondary}
            selected={selected.has(piece.id)}
            selectedColor={selectedColor}
          />
        ))}

      {preview.wall && wallShape(preview.wall, wallPolygon(preview.wall, wallsById), true, true)}

      {preview.roomPoints && preview.roomPoints.length > 1 && (
        <Line
          points={flat(preview.roomPoints)}
          closed={preview.roomPoints.length > 2}
          fill={dark ? 'rgba(144,202,249,0.15)' : 'rgba(25,118,210,0.12)'}
          stroke={selectedColor}
          strokeWidth={2 / scale}
          dash={[6 / scale, 4 / scale]}
          listening={false}
        />
      )}

      {handlePoints(home, selection).map(({ handle, point }) => (
        <Rect
          key={handle.kind}
          x={point[0]}
          y={point[1]}
          width={10 / scale}
          height={10 / scale}
          offsetX={5 / scale}
          offsetY={5 / scale}
          cornerRadius={handle.kind === 'rotate' ? 5 / scale : 0}
          fill={theme.palette.background.paper}
          stroke={selectedColor}
          strokeWidth={2 / scale}
          listening={false}
        />
      ))}

      {home.camera.mode === 'observer' && <Observer observer={home.camera.observer} scale={scale} color={selectedColor} paper={theme.palette.background.paper} />}

      {preview.rubberBand && (
        <Rect
          x={Math.min(preview.rubberBand[0][0], preview.rubberBand[1][0])}
          y={Math.min(preview.rubberBand[0][1], preview.rubberBand[1][1])}
          width={Math.abs(preview.rubberBand[1][0] - preview.rubberBand[0][0])}
          height={Math.abs(preview.rubberBand[1][1] - preview.rubberBand[0][1])}
          fill={dark ? 'rgba(144,202,249,0.12)' : 'rgba(25,118,210,0.1)'}
          stroke={selectedColor}
          strokeWidth={1 / scale}
          listening={false}
        />
      )}

      {preview.label && (
        <Label x={preview.label.point[0] + 14 / scale} y={preview.label.point[1] + 14 / scale} listening={false}>
          <Tag fill={theme.palette.background.paper} stroke={theme.palette.divider} strokeWidth={1 / scale} cornerRadius={4 / scale} />
          <Text text={preview.label.text} fontSize={fontSize} padding={4 / scale} fill={ink} />
        </Label>
      )}
    </>
  )
}

