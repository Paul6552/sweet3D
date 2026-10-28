import type { ThreeEvent } from '@react-three/fiber'
import { useMemo } from 'react'
import { DoubleSide, Shape, ShapeGeometry } from 'three'
import type { Home } from '../model/home'
import { dispatch } from '../store/editorStore'
import { PieceModel } from './PieceModel'
import { wallSlices } from './wallGeometry'

/** Mausbewegung in Pixeln, ab der ein Klick als Ziehen (Kamera) gilt. */
const CLICK_TOLERANCE = 4

interface HomeSceneProps {
  home: Home
  selection: string[]
  selectionColor: string
  showCeilings: boolean
}

function selectOnClick(event: ThreeEvent<MouseEvent>, id: string, selection: string[]) {
  if (event.delta > CLICK_TOLERANCE) return
  event.stopPropagation()
  const ids = event.shiftKey ? (selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]) : [id]
  dispatch({ type: 'select', ids })
}

function roomGeometry(points: [number, number][]): ShapeGeometry {
  return new ShapeGeometry(new Shape(points.map(([x, y]) => ({ x, y }) as never)))
}

/**
 * Inhalt der 3D-Ansicht in cm. Ebenen aus dem Plan (x, y) werden um +90° um die x-Achse
 * gedreht, sodass Plan-y zu three.js-z wird; extrudierte Wände wachsen dabei nach unten,
 * daher liegt ihr Ursprung an der Oberkante.
 */
export function HomeScene({ home, selection, selectionColor, showCeilings }: HomeSceneProps) {
  const wallsById = useMemo(() => new Map(home.walls.map((w) => [w.id, w])), [home.walls])
  const doorsAndWindows = useMemo(() => home.furniture.filter((p) => p.doorOrWindow), [home.furniture])
  const walls = useMemo(
    () => home.walls.map((wall) => ({ wall, slices: wallSlices(wall, home.wallHeight, doorsAndWindows, wallsById) })),
    [home.walls, home.wallHeight, doorsAndWindows, wallsById],
  )
  const rooms = useMemo(() => home.rooms.map((room) => ({ room, geometry: roomGeometry(room.points) })), [home.rooms])

  return (
    <group>
      {walls.map(({ wall, slices }) =>
        slices.map((slice, i) => (
          <mesh
            key={`${wall.id}-${i}`}
            geometry={slice.geometry}
            rotation-x={Math.PI / 2}
            position-y={slice.top}
            castShadow
            receiveShadow
            onClick={(e) => selectOnClick(e, wall.id, selection)}
          >
            <meshStandardMaterial color={selection.includes(wall.id) ? selectionColor : '#f1eee8'} side={DoubleSide} />
          </mesh>
        )),
      )}

      {rooms.map(({ room, geometry }) => (
        <group key={room.id}>
          {room.floorVisible && (
            <mesh geometry={geometry} rotation-x={Math.PI / 2} position-y={0.5} receiveShadow onClick={(e) => selectOnClick(e, room.id, selection)}>
              <meshStandardMaterial color={selection.includes(room.id) ? selectionColor : '#cdb79a'} side={DoubleSide} />
            </mesh>
          )}
          {room.ceilingVisible && showCeilings && (
            <mesh geometry={geometry} rotation-x={Math.PI / 2} position-y={home.wallHeight - 0.5}>
              <meshStandardMaterial color="#fafafa" side={DoubleSide} />
            </mesh>
          )}
        </group>
      ))}

      {home.furniture
        .filter((p) => p.visible)
        .map((piece) => (
          <PieceModel
            key={piece.id}
            piece={piece}
            selected={selection.includes(piece.id)}
            selectionColor={selectionColor}
            onSelect={(e, id) => selectOnClick(e, id, selection)}
          />
        ))}
    </group>
  )
}
