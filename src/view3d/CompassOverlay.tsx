import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import { useFrame } from '@react-three/fiber'
import { type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Vector3 } from 'three'
import { openCompassDialog } from '../dialogs/dialogStore'

const SIZE = 64
const forward = new Vector3()

/**
 * Dreht die Kompassrose über der 3D-Ansicht mit der Kamera: oben ist immer die Blickrichtung.
 * Läuft im Canvas und schreibt nur eine CSS-Variable, damit React nicht bei jedem Bild rendert.
 */
export function CompassHeading({ target, northDirection }: { target: RefObject<HTMLDivElement | null>; northDirection: number }) {
  useFrame(({ camera }) => {
    const element = target.current
    if (!element) return
    camera.getWorldDirection(forward)
    // Blickrichtung im Plan im Uhrzeigersinn ab Plan-oben (−z); senkrecht nach unten zählt die Kamera-Oberseite
    const heading = Math.abs(forward.y) > 0.999 ? Math.atan2(camera.up.x, -camera.up.z) : Math.atan2(forward.x, -forward.z)
    const rotation = `${(((northDirection - heading) * 180) / Math.PI).toFixed(1)}deg`
    if (element.style.getPropertyValue('--r') !== rotation) element.style.setProperty('--r', rotation)
  })
  return null
}

/** Kompassrose in der Ecke der 3D-Ansicht; ein Klick öffnet den Kompass-Dialog. */
export function CompassOverlay({ ref }: { ref: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const r = SIZE / 2
  const letter = (key: 'N' | 'E' | 'S' | 'W', angle: number) => {
    const x = r + Math.sin(angle) * (r - 10)
    const y = r - Math.cos(angle) * (r - 10)
    return (
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={key === 'N' ? 13 : 11}
        fontWeight={key === 'N' ? 700 : 500}
        fill={key === 'N' ? '#e53935' : 'currentColor'}
        // Buchstaben bleiben aufrecht, während sich die Rose dreht
        style={{ transform: 'rotate(calc(-1 * var(--r, 0deg)))', transformBox: 'fill-box', transformOrigin: 'center' }}
      >
        {t(`sun.rose.${key}`)}
      </text>
    )
  }
  return (
    <Tooltip title={t('compass.title')} placement="left">
      <Box
        ref={ref}
        onClick={openCompassDialog}
        sx={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          width: SIZE,
          height: SIZE,
          cursor: 'pointer',
          color: '#fff',
          '& svg': { display: 'block', transform: 'rotate(var(--r, 0deg))' },
        }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={r} cy={r} r={r - 1} fill="rgba(20,20,20,0.55)" stroke="rgba(255,255,255,0.6)" />
          <polygon points={`${r},${r - 14} ${r + 5},${r} ${r - 5},${r}`} fill="#e53935" />
          <polygon points={`${r},${r + 14} ${r + 5},${r} ${r - 5},${r}`} fill="rgba(255,255,255,0.85)" />
          {letter('N', 0)}
          {letter('E', Math.PI / 2)}
          {letter('S', Math.PI)}
          {letter('W', (3 * Math.PI) / 2)}
        </svg>
      </Box>
    </Tooltip>
  )
}
