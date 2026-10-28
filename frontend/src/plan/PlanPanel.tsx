import Add from '@mui/icons-material/Add'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CATALOG_PIECE_MIME, useCatalogStore } from '../catalog/catalogStore'
import { pieceFromCatalog } from '../model/furniture'
import { newId, type Home } from '../model/home'
import { dispatch, executeCommand, useEditorStore } from '../store/editorStore'

/** Sichtbarer Ausschnitt mit Rand um alle Objekte (mindestens 10 × 10 m). */
function viewBox(home: Home): string {
  const xs: number[] = [0, 1000]
  const ys: number[] = [0, 1000]
  for (const w of home.walls) {
    xs.push(w.xStart, w.xEnd)
    ys.push(w.yStart, w.yEnd)
  }
  for (const p of home.furniture) {
    xs.push(p.x - p.width / 2, p.x + p.width / 2)
    ys.push(p.y - p.depth / 2, p.y + p.depth / 2)
  }
  const margin = 100
  const minX = Math.min(...xs) - margin
  const minY = Math.min(...ys) - margin
  return `${minX} ${minY} ${Math.max(...xs) + margin - minX} ${Math.max(...ys) + margin - minY}`
}

/**
 * Vorläufige 2D-Ansicht: zeigt Wände und Möbel und nimmt Möbel per Drag & Drop an.
 * Der vollständige Planeditor (Wände zeichnen usw.) folgt in Phase 3.
 */
export function PlanPanel() {
  const { t } = useTranslation()
  const theme = useTheme()
  const svgRef = useRef<SVGSVGElement>(null)
  const home = useEditorStore((s) => s.home)
  const selection = useEditorStore((s) => s.selection)
  const findPiece = useCatalogStore((s) => s.findPiece)
  const loadCatalog = useCatalogStore((s) => s.load)
  if (!home) return null

  const addTestWall = () => {
    const last = home.walls.at(-1)
    const xStart = last?.xEnd ?? 0
    const yStart = last?.yEnd ?? 0
    // Rechtwinklige Kette im Uhrzeigersinn
    const direction = home.walls.length % 4
    const length = 300 + Math.round(Math.random() * 200)
    const [dx, dy] = [[length, 0], [0, length], [-length, 0], [0, -length]][direction]
    const id = newId('wall')
    executeCommand({
      type: 'addWalls',
      walls: [{ id, xStart, yStart, xEnd: xStart + dx, yEnd: yStart + dy, wallAtStart: last?.id ?? null, wallAtEnd: null, thickness: 15, height: null }],
    })
  }

  const onDrop = async (event: React.DragEvent) => {
    const catalogId = event.dataTransfer.getData(CATALOG_PIECE_MIME)
    const svg = svgRef.current
    if (!catalogId || !svg) return
    event.preventDefault()
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
    // Das Katalog-Panel kann in einem anderen Fenster liegen: Katalog hier ggf. nachladen
    await loadCatalog(useCatalogStore.getState().language ?? 'de')
    const piece = findPiece(catalogId)
    if (piece) {
      executeCommand({ type: 'addFurniture', pieces: [pieceFromCatalog(piece, Math.round(point.x), Math.round(point.y))] })
    }
  }

  const selectedColor = theme.palette.primary.main
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1, py: 0.5 }}>
        <Button size="small" startIcon={<Add />} onClick={addTestWall}>
          {t('plan.addTestWall')}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {t('plan.walls', { count: home.walls.length })} · {t('plan.placeholder')}
        </Typography>
      </Box>
      <svg
        ref={svgRef}
        viewBox={viewBox(home)}
        style={{ flex: 1, minHeight: 0, width: '100%', background: theme.palette.background.default }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(CATALOG_PIECE_MIME)) e.preventDefault()
        }}
        onDrop={(e) => void onDrop(e)}
        onClick={() => dispatch({ type: 'select', ids: [] })}
      >
        {home.walls.map((w) => (
          <line
            key={w.id}
            x1={w.xStart}
            y1={w.yStart}
            x2={w.xEnd}
            y2={w.yEnd}
            strokeWidth={w.thickness}
            strokeLinecap="square"
            stroke={selection.includes(w.id) ? selectedColor : theme.palette.text.primary}
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'select', ids: [w.id] })
            }}
          />
        ))}
        {home.furniture
          .filter((p) => p.visible)
          .map((p) => (
            <g
              key={p.id}
              transform={`translate(${p.x} ${p.y}) rotate(${(p.angle * 180) / Math.PI})`}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                dispatch({ type: 'select', ids: [p.id] })
              }}
            >
              {p.planIcon || p.icon ? (
                <image href={(p.planIcon ?? p.icon)!} x={-p.width / 2} y={-p.depth / 2} width={p.width} height={p.depth} preserveAspectRatio="none" />
              ) : null}
              <rect
                x={-p.width / 2}
                y={-p.depth / 2}
                width={p.width}
                height={p.depth}
                fill="none"
                stroke={selection.includes(p.id) ? selectedColor : theme.palette.text.secondary}
                strokeWidth={selection.includes(p.id) ? 4 : 1.5}
              />
            </g>
          ))}
      </svg>
    </Box>
  )
}
