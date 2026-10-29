import type { ThreeEvent } from '@react-three/fiber'
import { memo, useMemo } from 'react'
import { DoubleSide, Layers, MeshBasicMaterial, Shape, ShapeGeometry } from 'three'
import type { Home, Wall } from '../model/home'
import { defaultWallHeight, levelsAbove, visibleLevels } from '../model/levels'
import { dispatch } from '../store/editorStore'
import { surfaceMaterial } from './materials'
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

/**
 * Ebene für Teile, die nur Schatten werfen: die Schattenkamera der Sonne sieht sie, die Kamera,
 * die Kontaktschatten (AO) und Mausklicks nicht.
 */
export const SHADOW_LAYER = 1
const SHADOW_ONLY = new Layers()
SHADOW_ONLY.set(SHADOW_LAYER)
/** Wird nie gezeichnet, nur in die Schattenkarte; beidseitig, damit auch Böden und Decken Schatten werfen. */
const SHADOW_MATERIAL = new MeshBasicMaterial({ side: DoubleSide })
/** Nicht im Foto-Modus: dort würde der Pathtracer sie sichtbar zeichnen. */
const SHADOW_USER_DATA = { photo: false }

const WALL = '#f1eee8'
const FLOOR = '#cdb79a'
const CEILING = '#fafafa'

/** Materialien in der Reihenfolge der Gruppen aus wallSlices: Kanten, linke Seite, rechte Seite. */
function wallMaterials(wall: Wall, highlight: string | null) {
  return [surfaceMaterial(null, WALL, highlight), surfaceMaterial(wall.leftSide, WALL, highlight), surfaceMaterial(wall.rightSide, WALL, highlight)]
}

function roomGeometry(points: [number, number][]): ShapeGeometry {
  return new ShapeGeometry(new Shape(points.map(([x, y]) => ({ x, y }) as never)))
}

/** Kamerabewegungen ändern nur home.camera; die Szene muss dafür nicht neu gerendert werden. */
const sameScene = (a: HomeSceneProps, b: HomeSceneProps) =>
  a.selection === b.selection &&
  a.selectionColor === b.selectionColor &&
  a.showCeilings === b.showCeilings &&
  a.home.walls === b.home.walls &&
  a.home.rooms === b.home.rooms &&
  a.home.furniture === b.home.furniture &&
  a.home.levels === b.home.levels &&
  a.home.selectedLevel === b.home.selectedLevel &&
  a.home.wallHeight === b.home.wallHeight

/**
 * Inhalt der 3D-Ansicht in cm: wie in Sweet Home 3D die gewählte Ebene und alle darunter, jede
 * auf ihrer Höhe. Ohne Ebenen gibt es genau eine Gruppe auf Höhe 0. Die Ebenen darüber sind
 * ausgeblendet, werfen aber weiter Schatten, damit die Sonne nicht von oben in die Räume scheint.
 */
export const HomeScene = memo(function HomeScene({ home, selection, selectionColor, showCeilings }: HomeSceneProps) {
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
            shadowOnly={false}
          />
        </group>
      ))}
      {levelsAbove(home).map((level) => (
        <group key={level.id} position-y={level.elevation}>
          <LevelScene home={home} levelId={level.id} selection={selection} selectionColor={selectionColor} showCeilings={false} shadowOnly />
        </group>
      ))}
    </group>
  )
}, sameScene)

/** Eigenschaften eines Teils, das nur Schatten wirft. */
const shadowOnlyProps = { layers: SHADOW_ONLY, material: SHADOW_MATERIAL, userData: SHADOW_USER_DATA, castShadow: true }

/**
 * Eine Ebene. Flächen aus dem Plan (x, y) werden um +90° um die x-Achse gedreht, sodass Plan-y
 * zu three.js-z wird; extrudierte Wände wachsen dabei nach unten, daher liegt ihr Ursprung an der Oberkante.
 * {@code shadowOnly}: nur Wände, Böden und Decken als Schattenwerfer (für ausgeblendete Ebenen darüber).
 */
function LevelScene({
  home,
  levelId,
  selection,
  selectionColor,
  showCeilings,
  shadowOnly,
}: Omit<HomeSceneProps, 'home'> & { home: Home; levelId: string | null; shadowOnly: boolean }) {
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
            {...(shadowOnly
              ? shadowOnlyProps
              : {
                  castShadow: true,
                  receiveShadow: true,
                  material: wallMaterials(wall, selection.includes(wall.id) ? selectionColor : null),
                  onClick: (e: ThreeEvent<MouseEvent>) => selectOnClick(e, wall.id, selection),
                })}
          />
        )),
      )}

      {rooms.map(({ room, geometry }) => (
        <group key={room.id}>
          {shadowOnly ? (
            <mesh geometry={geometry} rotation-x={Math.PI / 2} position-y={0.5} {...shadowOnlyProps} />
          ) : (
            room.floorVisible && (
              <mesh
                geometry={geometry}
                rotation-x={Math.PI / 2}
                position-y={0.5}
                castShadow
                receiveShadow
                material={surfaceMaterial(room.floor, FLOOR, selection.includes(room.id) ? selectionColor : null)}
                onClick={(e) => selectOnClick(e, room.id, selection)}
              />
            )
          )}
          {/* Ohne Decke in der Ansicht (Luftansicht) wirft sie trotzdem Schatten, sonst scheint die Sonne in die Räume */}
          {room.ceilingVisible &&
            (showCeilings && !shadowOnly ? (
              <mesh geometry={geometry} rotation-x={Math.PI / 2} position-y={height - 0.5} castShadow receiveShadow material={surfaceMaterial(room.ceiling, CEILING)} />
            ) : (
              <mesh geometry={geometry} rotation-x={Math.PI / 2} position-y={height - 0.5} {...shadowOnlyProps} />
            ))}
        </group>
      ))}

      {levelFurniture
        .filter((p) => p.visible && !shadowOnly)
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
