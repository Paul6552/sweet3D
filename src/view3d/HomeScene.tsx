import type { ThreeEvent } from '@react-three/fiber'
import { memo, useMemo } from 'react'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { DoubleSide, Layers, MeshBasicMaterial, Shape, ShapeGeometry } from 'three'
import { useCatalogStore } from '../catalog/catalogStore'
import type { Home, HomePiece, Wall } from '../model/home'
import { defaultWallHeight, findLevel, levelsAbove, visibleLevels } from '../model/levels'
import { dispatch } from '../store/editorStore'
import { roofRectangles } from './indoorLight'
import { surfaceMaterial } from './materials'
import { PieceModel } from './PieceModel'
import { roomGeometry, staircaseHoles, type StaircaseShapeOf } from './staircases'
import { toShapes, wallSlices } from './wallGeometry'

/** Mausbewegung in Pixeln, ab der ein Klick als Ziehen (Kamera) gilt. */
const CLICK_TOLERANCE = 4

interface HomeSceneProps {
  home: Home
  selection: string[]
  selectionColor: string
  showCeilings: boolean
  /** Räume immer hell: nicht gezeichnete Decken und Ebenen darüber werfen keinen Schatten. */
  brightRooms: boolean
  /** Höchstzahl der Lichtquellen von Leuchten mit Schatten. */
  lampShadows: number
}

function selectOnClick(event: ThreeEvent<MouseEvent>, id: string, selection: string[]) {
  if (event.delta > CLICK_TOLERANCE) return
  event.stopPropagation()
  const ids = event.shiftKey ? (selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]) : [id]
  dispatch({ type: 'select', ids })
}

/**
 * Ebene für Teile, die nur Schatten werfen: die Schattenkarten sehen sie (siehe ShadowUpdates), die Kamera,
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

/** Kamerabewegungen ändern nur home.camera; die Szene muss dafür nicht neu gerendert werden. */
const sameScene = (a: HomeSceneProps, b: HomeSceneProps) =>
  a.selection === b.selection &&
  a.selectionColor === b.selectionColor &&
  a.showCeilings === b.showCeilings &&
  a.brightRooms === b.brightRooms &&
  a.lampShadows === b.lampShadows &&
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
export const HomeScene = memo(function HomeScene({ home, selection, selectionColor, showCeilings, brightRooms, lampShadows }: HomeSceneProps) {
  const shadowLamps = useMemo(() => lampsWithShadows(home, lampShadows), [home, lampShadows])
  const catalog = useCatalogStore((s) => s.furniture)
  // Möbel aus älteren Projekten kennen die Öffnung nicht selbst, dann gilt die des Katalogeintrags
  const staircaseShapeOf = useMemo((): StaircaseShapeOf => {
    const shapes = new Map(catalog?.categories.flatMap((c) => c.pieces.map((p) => [p.id, p.staircaseCutOutShape])))
    return (piece: HomePiece) => (piece.staircaseCutOutShape !== undefined ? piece.staircaseCutOutShape : (shapes.get(piece.catalogId ?? '') ?? null))
  }, [catalog])
  const sceneProps = { home, selection, selectionColor, brightRooms, lampShadows, shadowLamps, staircaseShapeOf }
  return (
    <group>
      {visibleLevels(home).map((level) => (
        <group key={level?.id ?? 'home'} position-y={level?.elevation ?? 0}>
          <LevelScene {...sceneProps} levelId={level?.id ?? null} showCeilings={showCeilings} shadowOnly={false} />
        </group>
      ))}
      {!brightRooms &&
        levelsAbove(home).map((level) => (
          <group key={level.id} position-y={level.elevation}>
            <LevelScene {...sceneProps} levelId={level.id} showCeilings={false} shadowOnly />
          </group>
        ))}
    </group>
  )
}, sameScene)

/**
 * Leuchten, deren Licht Schatten wirft, damit es im Raum bleibt: zuerst die der gewählten Ebene,
 * dann die hellsten, bis {@code budget} Lichtquellen erreicht sind. Hängt nicht von der Kamera ab,
 * sonst müssten beim Umsehen ständig alle Shader neu übersetzt werden.
 */
function lampsWithShadows(home: Home, budget: number): Set<string> {
  const visible = new Set(visibleLevels(home).map((l) => l?.id ?? null))
  const lamps = home.furniture
    .filter((p) => p.visible && p.light && p.light.power > 0 && visible.has(p.level))
    .sort((a, b) => Number(b.level === home.selectedLevel) - Number(a.level === home.selectedLevel) || b.light!.power - a.light!.power)
  const result = new Set<string>()
  let sources = 0
  for (const lamp of lamps) {
    const count = lamp.light!.sources.length
    if (sources + count > budget) continue
    sources += count
    result.add(lamp.id)
  }
  return result
}

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
  brightRooms,
  shadowLamps,
  staircaseShapeOf,
  shadowOnly,
}: HomeSceneProps & { levelId: string | null; shadowOnly: boolean; shadowLamps: Set<string>; staircaseShapeOf: StaircaseShapeOf }) {
  const levelWalls = useMemo(() => home.walls.filter((w) => w.level === levelId), [home.walls, levelId])
  const levelRooms = useMemo(() => home.rooms.filter((r) => r.level === levelId), [home.rooms, levelId])
  const levelFurniture = useMemo(() => home.furniture.filter((p) => p.level === levelId), [home.furniture, levelId])
  const height = defaultWallHeight(home, levelId)
  // Wie in Sweet Home 3D: Wände aller Ebenen außer der untersten beginnen schon an der Unterseite der Decke darunter
  const level = findLevel(home, levelId)
  const floorThickness = level && level.elevation > home.levels[0].elevation ? level.floorThickness : 0
  const wallsById = useMemo(() => new Map(levelWalls.map((w) => [w.id, w])), [levelWalls])
  const doorsAndWindows = useMemo(() => levelFurniture.filter((p) => p.doorOrWindow), [levelFurniture])
  const walls = useMemo(
    () => levelWalls.map((wall) => ({ wall, slices: wallSlices(wall, height, doorsAndWindows, wallsById, floorThickness) })),
    [levelWalls, height, doorsAndWindows, wallsById, floorThickness],
  )
  // Öffnungen der Treppen: im Boden von Treppen, die von unten durch die Decke darunter kommen,
  // in der Decke von Treppen, die höher als die Decke reichen
  const { floorHoles, ceilingHoles } = useMemo(
    () => {
      const elevation = level?.elevation ?? 0
      const ceiling = elevation + height
      return {
        floorHoles: level ? staircaseHoles(home, elevation - level.floorThickness, elevation, staircaseShapeOf) : [],
        ceilingHoles: staircaseHoles(home, ceiling, ceiling, staircaseShapeOf),
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur Möbel und Höhen der Ebenen zählen
    [home.furniture, home.levels, levelId, height, staircaseShapeOf],
  )
  const rooms = useMemo(
    () =>
      levelRooms.map((room) => {
        const floor = roomGeometry(room.points, floorHoles)
        const ceiling = floorHoles.length === 0 && ceilingHoles.length === 0 ? floor : roomGeometry(room.points, ceilingHoles)
        return { room, floor, ceiling }
      }),
    [levelRooms, floorHoles, ceilingHoles],
  )
  // Dach über den umschlossenen Räumen, auch ohne angezeigte Decke: sonst scheint die Sonne von oben ins Haus
  // und durch die Fenster wieder hinaus
  const roof = useMemo(
    () => {
      const rectangles = roofRectangles(home, levelId)
      if (rectangles.length === 0) return null
      if (ceilingHoles.length === 0) {
        return new ShapeGeometry(rectangles.map(([x, y, w, d]) => new Shape().moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + d).lineTo(x, y + d)))
      }
      // Die Rechtecke überlappen sich nicht und bilden zusammen ein Mehrfachpolygon
      const roof = rectangles.map(([x, y, w, d]): Polygon => [[[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]]])
      return new ShapeGeometry(toShapes(polygonClipping.difference(roof, ...ceilingHoles)))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur Wände und Höhen der Ebenen zählen
    [home.walls, home.levels, home.wallHeight, levelId, ceilingHoles],
  )

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

      {rooms.map(({ room, floor, ceiling }) => (
        <group key={room.id}>
          {shadowOnly ? (
            <mesh geometry={floor} rotation-x={Math.PI / 2} position-y={0.5} {...shadowOnlyProps} />
          ) : (
            room.floorVisible && (
              <mesh
                geometry={floor}
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
              <mesh geometry={ceiling} rotation-x={Math.PI / 2} position-y={height - 0.5} castShadow receiveShadow material={surfaceMaterial(room.ceiling, CEILING)} />
            ) : (
              !brightRooms && <mesh geometry={ceiling} rotation-x={Math.PI / 2} position-y={height - 0.5} {...shadowOnlyProps} />
            ))}
        </group>
      ))}

      {!brightRooms && roof && <mesh geometry={roof} rotation-x={Math.PI / 2} position-y={height - 0.5} {...shadowOnlyProps} />}

      {levelFurniture
        .filter((p) => p.visible && !shadowOnly)
        .map((piece) => (
          <PieceModel
            key={piece.id}
            piece={piece}
            selected={selection.includes(piece.id)}
            selectionColor={selectionColor}
            lightShadows={shadowLamps.has(piece.id)}
            onSelect={(e, id) => selectOnClick(e, id, selection)}
          />
        ))}
    </>
  )
}
