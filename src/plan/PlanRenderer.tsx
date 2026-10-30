import { useTheme } from '@mui/material/styles'
import { memo, useCallback, useMemo } from 'react'
import { Arrow, Circle, Group, Image, Label, Line, Rect, Shape, Tag, Text } from 'react-konva'
import { argbToCss } from '../model/colors'
import type { Compass, DimensionLine, Home, HomePiece, Label as HomeLabel, ObserverCamera, Roof, Wall } from '../model/home'
import { dimensionLength, dimensionOffsetPoints, labelCorners, pitchedSize, polygonArea, polygonCentroid, wallPolygon, type Point } from '../model/geometry'
import { edgeProfile, GABLE, roofModels, type RoofModel } from '../model/roofs'
import { compassRadius, handlePoints, observerHandle, OBSERVER_RADIUS } from './hitTest'
import type { PlanView } from './planStore'
import { useResolvedRef } from '../storage/contents'
import { useImage } from './useImage'

export interface PlanPreview {
  /** Wand, die gerade gezeichnet wird. */
  wall?: Wall
  /** Punkte des Raums, der gerade gezeichnet wird (inkl. Mauszeiger). */
  roomPoints?: Point[]
  /** Punkte des Dachs, das gerade gezeichnet wird (inkl. Mauszeiger). */
  roofPoints?: Point[]
  /** Gaube, die gerade aufgezogen wird. */
  dormer?: Point[]
  rubberBand?: [Point, Point]
  /** Maßlinie, die gerade gezeichnet wird. */
  dimensionLine?: DimensionLine
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
  /** Wände der Ebene darunter, blass zur Orientierung. */
  wallsBelow?: Wall[]
  /** Dächer tieferer Ebenen, die in diese Ebene reichen, mit der Linie 1 m über dem Boden (Kniestock). */
  roofsBelow?: { roof: Roof; model: RoofModel; contour: [Point, Point][] }[]
}

const ROOF_INK = '#b0642a'
const ROOF_INK_DARK = '#e3a05f'
const degreesText = (radians: number) => `${Math.round((radians * 180) / Math.PI)}°`

/**
 * Dach im Plan: Umriss mit Überstand gestrichelt, First, Grate und Kehlen, Giebelkanten dick und je
 * Fläche ein Pfeil die Neigung hinunter.
 */
const RoofPlanShape = memo(function RoofPlanShape({
  roof,
  model,
  scale,
  color,
  selected,
  selectedColor,
  faint,
  contour,
}: {
  roof: Roof
  model: RoofModel
  scale: number
  color: string
  selected: boolean
  selectedColor: string
  faint?: boolean
  contour?: [Point, Point][]
}) {
  const stroke = selected ? selectedColor : color
  const outer = model.outline[0]
  if (!outer) return null
  const gables = outer
    .map((a, k) => ({ a, b: outer[(k + 1) % outer.length], edge: roof.edges[model.edgeIndex[k]] }))
    .filter(({ edge }) => edgeProfile(roof, edge)[0].slope >= GABLE - 1e-6)
  const arrows = faint
    ? []
    : model.surfaces
        // Nur Flächen, die groß genug für Pfeil und Beschriftung sind; bei Tonnen- und Mansarddächern nur die steilste und die flachste je Kante
        .filter((s) => s.slope > 0.01 && polygonArea(s.rings[0]) * scale * scale > 1600)
        .filter((s, _, all) => {
          const slopes = all.filter((o) => o.edge === s.edge).map((o) => o.slope)
          return s.slope === Math.max(...slopes) || s.slope === Math.min(...slopes)
        })
        .map((s) => {
          const [cx, cy] = polygonCentroid(s.rings[0])
          const length = Math.max(50, 28 / scale)
          // Pfeil die Fläche hinunter, also entgegen der Richtung nach oben
          return { cx, cy, dx: -s.up[0] * length, dy: -s.up[1] * length, text: degreesText(s.slope) }
        })
  const fontSize = 10 / scale
  return (
    <Group listening={false} opacity={faint ? 0.5 : 1}>
      {model.outline.map((ring, i) => (
        <Line
          key={`outline-${i}`}
          points={flat(ring)}
          closed
          fill={faint ? undefined : `${color}14`}
          stroke={stroke}
          strokeWidth={(selected ? 2.5 : 1.2) / scale}
          dash={[8 / scale, 4 / scale]}
        />
      ))}
      {selected && model.wallLine.map((ring, i) => <Line key={`wall-${i}`} points={flat(ring)} closed stroke={stroke} strokeWidth={1 / scale} dash={[2 / scale, 3 / scale]} />)}
      {model.lines.map(([a, b], i) => (
        <Line key={`line-${i}`} points={[a[0], a[1], b[0], b[1]]} stroke={stroke} strokeWidth={(selected ? 2 : 1.2) / scale} />
      ))}
      {gables.map(({ a, b }, i) => (
        <Line key={`gable-${i}`} points={[a[0], a[1], b[0], b[1]]} stroke={stroke} strokeWidth={4 / scale} lineCap="round" />
      ))}
      {contour?.map(([a, b], i) => (
        <Line key={`contour-${i}`} points={[a[0], a[1], b[0], b[1]]} stroke={color} strokeWidth={2 / scale} dash={[10 / scale, 3 / scale, 2 / scale, 3 / scale]} />
      ))}
      {arrows.map(({ cx, cy, dx, dy, text }, i) => (
        <Group key={`arrow-${i}`}>
          <Arrow points={[cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2]} stroke={stroke} fill={stroke} strokeWidth={1.2 / scale} pointerLength={6 / scale} pointerWidth={5 / scale} />
          <Text x={cx} y={cy} text={text} fontSize={fontSize} fill={stroke} align="center" width={60 / scale} offsetX={30 / scale} offsetY={-4 / scale} />
        </Group>
      ))}
    </Group>
  )
})

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

const PieceShape = memo(function PieceShape({ piece, scale, stroke, selected, selectedColor }: { piece: HomePiece; scale: number; stroke: string; selected: boolean; selectedColor: string }) {
  // Dachfenster liegen geneigt: Grundriss in voller Tiefe, statt Symbol und Öffnungsbogen nur Rahmen und Glas
  const pitched = !!piece.pitch
  const image = useImage(useResolvedRef(pitched ? null : (piece.planIcon ?? piece.icon)))
  const w = piece.width
  const d = pitchedSize(piece).depth
  const inset = Math.min(w, d) * 0.12
  // Symbol wie in Sweet Home 3D mit erhaltenem Seitenverhältnis einpassen
  const fit = image ? Math.min(w / image.width, d / image.height) : 0
  const iw = image ? image.width * fit : 0
  const ih = image ? image.height * fit : 0
  return (
    <Group x={piece.x} y={piece.y} rotation={(piece.angle * 180) / Math.PI} listening={false}>
      {image && <Image image={image} x={-iw / 2} y={-ih / 2} width={iw} height={ih} opacity={0.9} />}
      {pitched && <Rect x={-w / 2 + inset} y={-d / 2 + inset} width={w - 2 * inset} height={d - 2 * inset} stroke={stroke} strokeWidth={1 / scale} />}
      {!pitched &&
        piece.doorOrWindowInfo?.sashes.map((sash, i) => (
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
})

const lengthFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, useGrouping: false })

/**
 * Maßlinie wie in Sweet Home 3D: Hilfslinien von den gemessenen Punkten zur verschobenen
 * Linie, schräge Endstriche und die Länge in cm über der Linie.
 */
const DimensionShape = memo(function DimensionShape({ line, scale, color, dashed }: { line: DimensionLine; scale: number; color: string; dashed?: boolean }) {
  const [a, b] = dimensionOffsetPoints(line)
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
  // Text immer lesbar, also nicht auf dem Kopf
  const upright = Math.cos(angle) < -1e-6 || (Math.abs(Math.cos(angle)) <= 1e-6 && Math.sin(angle) > 0)
  const textAngle = upright ? angle + Math.PI : angle
  const fontSize = 11 / scale
  const tick = 5 / scale
  const overshoot = (Math.sign(line.offset) || 1) * (4 / scale)
  const nx = -Math.sin(angle) * overshoot
  const ny = Math.cos(angle) * overshoot
  return (
    <Group listening={false}>
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath()
          ctx.moveTo(line.xStart, line.yStart)
          ctx.lineTo(a[0] + nx, a[1] + ny)
          ctx.moveTo(line.xEnd, line.yEnd)
          ctx.lineTo(b[0] + nx, b[1] + ny)
          ctx.moveTo(a[0], a[1])
          ctx.lineTo(b[0], b[1])
          for (const [x, y] of [a, b]) {
            ctx.moveTo(x - Math.cos(angle + Math.PI / 4) * tick, y - Math.sin(angle + Math.PI / 4) * tick)
            ctx.lineTo(x + Math.cos(angle + Math.PI / 4) * tick, y + Math.sin(angle + Math.PI / 4) * tick)
          }
          ctx.strokeShape(shape)
        }}
        stroke={color}
        strokeWidth={1 / scale}
        dash={dashed ? [4 / scale, 3 / scale] : undefined}
      />
      <Text
        x={(a[0] + b[0]) / 2}
        y={(a[1] + b[1]) / 2}
        rotation={(textAngle * 180) / Math.PI}
        text={lengthFormat.format(dimensionLength(line))}
        fontSize={fontSize}
        fill={color}
        align="center"
        width={400 / scale}
        offsetX={200 / scale}
        offsetY={fontSize + 2 / scale}
      />
    </Group>
  )
})

/** Text im Plan; die Schriftgröße ist in cm und wächst daher mit dem Zoom. */
const LabelShape = memo(function LabelShape({ label, scale, ink, selected, selectedColor }: { label: HomeLabel; scale: number; ink: string; selected: boolean; selectedColor: string }) {
  const lines = label.text.split('\n').length
  const width = 100000
  return (
    <Group listening={false}>
      <Text
        x={label.x}
        y={label.y}
        rotation={(label.angle * 180) / Math.PI}
        text={label.text}
        fontSize={label.fontSize}
        lineHeight={1.2}
        fill={label.color === null ? ink : argbToCss(label.color)}
        align="center"
        width={width}
        offsetX={width / 2}
        offsetY={lines * label.fontSize * 1.2 - label.fontSize * 0.2}
      />
      {selected && <Line points={flat(labelCorners(label))} closed stroke={selectedColor} strokeWidth={2 / scale} dash={[4 / scale, 3 / scale]} />}
    </Group>
  )
})

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

/**
 * Kompassrose wie in Sweet Home 3D: Kreis mit Teilstrichen und Nordpfeil, gedreht um die Nordrichtung.
 * Die Größe ist in cm und wächst beim Zoomen mit, bleibt aber am Bildschirm immer lesbar (siehe compassRadius).
 */
function CompassRose({ compass, scale, color, paper }: { compass: Compass; scale: number; color: string; paper: string }) {
  const r = compassRadius(compass, scale)
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const angle = (i * Math.PI) / 12
    const inner = i % 6 === 0 ? r * 0.78 : r * 0.88
    return [Math.sin(angle) * inner, -Math.cos(angle) * inner, Math.sin(angle) * r, -Math.cos(angle) * r]
  })
  return (
    <Group x={compass.x} y={compass.y} rotation={(compass.northDirection * 180) / Math.PI} listening={false}>
      <Circle radius={r} stroke={color} strokeWidth={1.2 / scale} fill={paper} opacity={0.9} />
      {ticks.map((points, i) => (
        <Line key={i} points={points} stroke={color} strokeWidth={1 / scale} />
      ))}
      {/* Nordhälfte gefüllt, Südhälfte nur umrandet */}
      <Line points={[0, -r * 0.75, r * 0.18, 0, -r * 0.18, 0]} closed fill={color} stroke={color} strokeWidth={1 / scale} />
      <Line points={[0, r * 0.75, r * 0.18, 0, -r * 0.18, 0]} closed fill={paper} stroke={color} strokeWidth={1 / scale} />
      <Text text="N" x={-r} y={-r - r * 0.32 - 2 / scale} width={2 * r} align="center" fontSize={r * 0.32} fontStyle="bold" fill={color} />
    </Group>
  )
}

/** Zeichnet den Plan in Plankoordinaten (cm); Linienbreiten und Schrift bleiben am Bildschirm konstant. */
export function PlanRenderer({ home, selection, view, width, height, preview, wallsBelow, roofsBelow }: PlanRendererProps) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const { scale } = view
  const ink = theme.palette.text.primary
  const selectedColor = theme.palette.primary.main
  const hatch = useHatchPattern(dark ? '#9aa0a6' : '#5f6368', dark ? '#3c4043' : '#e8eaed')
  const selected = useMemo(() => new Set(selection), [selection])
  const wallsById = useMemo(() => new Map(home.walls.map((w) => [w.id, w])), [home.walls])
  const below = useMemo(() => {
    const byId = new Map((wallsBelow ?? []).map((w) => [w.id, w]))
    return (wallsBelow ?? []).map((wall) => ({ id: wall.id, polygon: wallPolygon(wall, byId) }))
  }, [wallsBelow])
  const fontSize = 12 / scale
  const roofInk = dark ? ROOF_INK_DARK : ROOF_INK
  const models = useMemo(() => roofModels(home), [home])

  const wallShape = useCallback(
    (wall: Wall, polygon: Point[], isSelected: boolean, dashed = false) => (
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
    ),
    [hatch, scale, selectedColor, ink],
  )

  // Wände, Räume und Möbel nur neu aufbauen, wenn sie sich ändern, nicht bei jeder Bewegung des Besuchers
  const shapes = useMemo(
    () => (
      <>
        {below.map(({ id, polygon }) => (
          <Line
            key={`below-${id}`}
            points={flat(polygon)}
            closed
            fill={dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
            stroke={dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}
            strokeWidth={1 / scale}
            listening={false}
          />
        ))}

        {home.rooms.map((room) => {
          const [cx, cy] = polygonCentroid(room.points)
          const area = (polygonArea(room.points) / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 })
          const isSelected = selected.has(room.id)
          return (
            <Group key={room.id} listening={false}>
              <Line
                points={flat(room.points)}
                closed
                fill={room.floor?.color != null ? `${argbToCss(room.floor.color)}66` : dark ? 'rgba(144,202,249,0.10)' : 'rgba(25,118,210,0.07)'}
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

        {roofsBelow?.map(({ roof, model, contour }) => (
          <RoofPlanShape key={`below-${roof.id}`} roof={roof} model={model} scale={scale} color={roofInk} selected={false} selectedColor={selectedColor} faint contour={contour} />
        ))}

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

        {home.roofs
          .filter((roof) => roof.visible || selected.has(roof.id))
          .map((roof) => {
            const model = models.get(roof.id)
            return model && <RoofPlanShape key={roof.id} roof={roof} model={model} scale={scale} color={roofInk} selected={selected.has(roof.id)} selectedColor={selectedColor} />
          })}

        {home.dimensionLines.map((line) => (
          <DimensionShape key={line.id} line={line} scale={scale} color={selected.has(line.id) ? selectedColor : ink} />
        ))}

        {home.labels.map((label) => (
          <LabelShape key={label.id} label={label} scale={scale} ink={ink} selected={selected.has(label.id)} selectedColor={selectedColor} />
        ))}
      </>
    ),
    [below, home.rooms, home.walls, home.roofs, home.furniture, home.dimensionLines, home.labels, wallsById, selected, scale, dark, theme, fontSize, selectedColor, wallShape, ink, models, roofInk, roofsBelow],
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

      {home.compass.visible && <CompassRose compass={home.compass} scale={scale} color={theme.palette.text.secondary} paper={theme.palette.background.paper} />}

      {shapes}

      {preview.dimensionLine && <DimensionShape line={preview.dimensionLine} scale={scale} color={selectedColor} dashed />}

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

      {preview.roofPoints && preview.roofPoints.length > 1 && (
        <Line
          points={flat(preview.roofPoints)}
          closed={preview.roofPoints.length > 2}
          fill={`${roofInk}22`}
          stroke={roofInk}
          strokeWidth={2 / scale}
          dash={[6 / scale, 4 / scale]}
          listening={false}
        />
      )}

      {preview.dormer && <Line points={flat(preview.dormer)} closed fill={`${roofInk}33`} stroke={selectedColor} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} listening={false} />}

      {handlePoints(home, selection).map(({ handle, point }, i) => (
        <Rect
          key={`${handle.kind}-${i}`}
          x={point[0]}
          y={point[1]}
          width={10 / scale}
          height={10 / scale}
          offsetX={5 / scale}
          offsetY={5 / scale}
          cornerRadius={handle.kind === 'rotate' || handle.kind === 'roofMid' ? 5 / scale : 0}
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

