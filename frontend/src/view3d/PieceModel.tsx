import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { BoxGeometry, type Object3D } from 'three'
import type { HomePiece } from '../model/home'
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
