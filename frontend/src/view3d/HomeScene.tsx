import type { ThreeEvent } from '@react-three/fiber'
import { useMemo } from 'react'
import { DoubleSide, Shape, ShapeGeometry } from 'three'
import type { Home } from '../model/home'
import { defaultWallHeight, visibleLevels } from '../model/levels'
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
 * Inhalt der 3D-Ansicht in cm: wie in Sweet Home 3D die gewählte Ebene und alle darunter, jede
 * auf ihrer Höhe. Ohne Ebenen gibt es genau eine Gruppe auf Höhe 0.
 */
export function HomeScene({ home, selection, selectionColor, showCeilings }: HomeSceneProps) {
  return (
    <group>
      {visibleLevels(home).map((level) => (
        <group key={level?.id ?? 'home'} position-y={level?.elevation ?? 0}>
          <LevelScene
            home={home}
            levelId={level?.id ?? null}
            selection={selection}
            selectionColor={selectionColor}
            showCeilings={showCeilings}
          />
        </group>
      ))}
    </group>
  )
}

/**
 * Eine Ebene. Flächen aus dem Plan (x, y) werden um +90° um die x-Achse gedreht, sodass Plan-y
 * zu three.js-z wird; extrudierte Wände wachsen dabei nach unten, daher liegt ihr Ursprung an der Oberkante.
 */
function LevelScene({ home, levelId, selection, selectionColor, showCeilings }: Omit<HomeSceneProps, 'home'> & { home: Home; levelId: string | null }) {
  const levelWalls = useMemo(() => home.walls.filter((w) => w.level === levelId), [home.walls, levelId])
  const levelRooms = useMemo(() => home.rooms.filter((r) => r.level === levelId), [home.rooms, levelId])
  const levelFurniture = useMemo(() => home.furniture.filter((p) => p.level === levelId), [home.furniture, levelId])
  const height = defaultWallHeight(home, levelId)
  const wallsById = useMemo(() => new Map(levelWalls.map((w) => [w.id, w])), [levelWalls])
  const doorsAndWindows = useMemo(() => levelFurniture.filter((p) => p.doorOrWindow), [levelFurniture])
  const walls = useMemo(
    () => levelWalls.map((wall) => ({ wall, slices: wallSlices(wall, height, doorsAndWindows, wallsById) })),
    [levelWalls, height, doorsAndWindows, wallsById],
  )
  const rooms = useMemo(() => levelRooms.map((room) => ({ room, geometry: roomGeometry(room.points) })), [levelRooms])

  return (
    <>
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
            <mesh geometry={geometry} rotation-x={Math.PI / 2} position-y={height - 0.5}>
              <meshStandardMaterial color="#fafafa" side={DoubleSide} />
            </mesh>
          )}
        </group>
      ))}

      {levelFurniture
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
    </>
  )
}
