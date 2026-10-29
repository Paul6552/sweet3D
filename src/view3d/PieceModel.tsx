import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, Vector3, type Material, type Object3D } from 'three'
import type { HomePiece } from '../model/home'
import { surfaceMaterial } from './materials'
import { loadNormalizedModel } from './modelLoader'

interface PieceModelProps {
  piece: HomePiece
  selected: boolean
  selectionColor: string
  onSelect: (event: ThreeEvent<MouseEvent>, id: string) => void
}

/**
 * Möbel in 3D. Plan (x, y) entspricht three.js (x, z), die Höhe ist y; der Drehwinkel im Plan
 * läuft im Uhrzeigersinn, daher wird um -angle um die y-Achse gedreht.
 */
export function PieceModel({ piece, selected, selectionColor, onSelect }: PieceModelProps) {
  const [loaded, setLoaded] = useState<{ key: string; object: Object3D } | null>(null)
  const { model, modelRotation, width, height, depth } = piece
  const key = JSON.stringify([model, modelRotation, width, height, depth])

  useEffect(() => {
    if (!model) return
    let cancelled = false
    loadNormalizedModel(model, modelRotation, { width, height, depth }).then(
      (object) => !cancelled && setLoaded({ key, object }),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [key, model, modelRotation, width, height, depth])

  const object = loaded?.key === key ? loaded.object : null
  const appearance = JSON.stringify([piece.color, piece.texture ?? null])
  useEffect(() => {
    if (object) applyAppearance(object, piece.color, piece.texture ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appearance fasst Farbe und Textur zusammen
  }, [object, appearance])
  return (
    <group
      position={[piece.x, piece.elevation, piece.y]}
      rotation-y={-piece.angle}
      onClick={(event) => onSelect(event, piece.id)}
    >
      {object ? (
        <primitive object={object} />
      ) : (
        // Platzhalter, solange das Modell lädt
        <mesh position-y={height / 2}>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color="#b0b0b0" transparent opacity={0.5} />
        </mesh>
      )}
      {selected && (
        <lineSegments position-y={height / 2} raycast={() => null}>
          <edgesGeometry args={[new BoxGeometry(width + 2, height + 2, depth + 2)]} />
          <lineBasicMaterial color={selectionColor} />
        </lineSegments>
      )}
    </group>
  )
}

interface Original {
  material: Material | Material[]
  geometry: BufferGeometry
}

/**
 * Farbe bzw. Textur über das ganze Modell wie in Sweet Home 3D; ohne beides die Materialien des
 * Modells. Für Texturen bekommt jedes Teil UV-Koordinaten in cm, projiziert entlang der Achse,
 * zu der die Fläche am meisten zeigt. Das Modell ist eine eigene Kopie je Möbel (loadNormalizedModel).
 */
function applyAppearance(object: Object3D, color: number | null, texture: HomePiece['texture']) {
  object.updateMatrixWorld(true)
  const material = color !== null || texture ? surfaceMaterial({ color: texture ? null : color, texture: texture ?? null }, '#ffffff') : null
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const original = (child.userData.original ??= { material: child.material, geometry: child.geometry }) as Original
    child.material = material ?? original.material
    // Lage des Teils im Modell, unabhängig von Position und Drehung des Möbels
    const local = new Matrix4().copy(object.matrixWorld).invert().multiply(child.matrixWorld)
    child.geometry = texture ? projectedUvs(original.geometry, local) : original.geometry
  })
}

function projectedUvs(source: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  geometry.computeVertexNormals()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uvs = new Float32Array(position.count * 2)
  const p = new Vector3()
  const n = new Vector3()
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(matrix)
    n.fromBufferAttribute(normal, i).transformDirection(matrix)
    const [ax, ay, az] = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)]
    const [u, v] = ay >= ax && ay >= az ? [p.x, p.z] : ax >= az ? [p.z, p.y] : [p.x, p.y]
    uvs[i * 2] = u
    uvs[i * 2 + 1] = v
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  return geometry
}
