import DirectionsWalk from '@mui/icons-material/DirectionsWalk'
import FitScreen from '@mui/icons-material/FitScreen'
import ThreeDRotation from '@mui/icons-material/ThreeDRotation'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { Canvas } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Vector3 } from 'three'
import type { CameraMode, Home } from '../model/home'
import { homeBounds } from '../plan/hitTest'
import { dispatch, useEditorStore } from '../store/editorStore'
import { AerialCamera, ObserverCameraRig, type SceneBounds } from './cameras'
import { HomeScene } from './HomeScene'

function sceneBounds(home: Home): SceneBounds {
  const b = homeBounds(home) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  const center = new Vector3((b.minX + b.maxX) / 2, home.wallHeight / 3, (b.minY + b.maxY) / 2)
  const radius = Math.max(b.maxX - b.minX, b.maxY - b.minY, home.wallHeight) / 2 + 100
  return { center, radius }
}

/** Licht wie bei Tageslicht: Himmel/Boden-Ambiente und eine Sonne mit Schatten über dem Projekt. */
function Lights({ bounds }: { bounds: SceneBounds }) {
  const { center, radius } = bounds
  const sun = center.clone().add(new Vector3(radius * 0.8, radius * 2, radius * 0.6))
  return (
    <>
      <hemisphereLight args={['#e8f1ff', '#8a7f6a', 1.4]} />
      <directionalLight
        position={sun}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-radius * 1.5}
        shadow-camera-right={radius * 1.5}
        shadow-camera-top={radius * 1.5}
        shadow-camera-bottom={-radius * 1.5}
        shadow-camera-near={1}
        shadow-camera-far={radius * 6}
        shadow-bias={-0.0005}
      >
        <object3D attach="target" position={center} />
      </directionalLight>
    </>
  )
}

/** 3D-Ansicht mit Luftansicht und virtuellem Besucher (Modus wird mit dem Plan synchronisiert). */
export function View3DPanel() {
  const { t } = useTranslation()
  const theme = useTheme()
  const home = useEditorStore((s) => s.home)
  const selection = useEditorStore((s) => s.selection)
  const [fitRequest, setFitRequest] = useState(0)
  // Nur bei Änderungen der Geometrie neu berechnen, nicht bei jeder Kamerabewegung
  const walls = home?.walls
  const furniture = home?.furniture
  const rooms = home?.rooms
  const wallHeight = home?.wallHeight
  const bounds = useMemo(
    () => sceneBounds({ walls: walls ?? [], furniture: furniture ?? [], rooms: rooms ?? [], wallHeight: wallHeight ?? 250 } as Home),
    [walls, furniture, rooms, wallHeight],
  )
  if (!home) return null
  const mode = home.camera.mode

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }} data-view3d>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_, value: CameraMode | null) => value && dispatch({ type: 'camera', camera: { mode: value } })}
        >
          <ToggleButton value="aerial" aria-label={t('view3d.aerial')} sx={{ px: 1, py: 0.5 }}>
            <Tooltip title={t('view3d.aerial')}>
              <ThreeDRotation fontSize="small" />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="observer" aria-label={t('view3d.observer')} sx={{ px: 1, py: 0.5 }}>
            <Tooltip title={t('view3d.observer')}>
              <DirectionsWalk fontSize="small" />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
        {mode === 'aerial' && (
          <Tooltip title={t('plan.fit')}>
            <IconButton size="small" onClick={() => setFitRequest((n) => n + 1)} aria-label={t('plan.fit')}>
              <FitScreen fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 1 }}>
          {t(mode === 'aerial' ? 'view3d.aerialHint' : 'view3d.observerHint')}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', '& canvas': { outline: 'none' } }}>
        <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }} onPointerMissed={() => dispatch({ type: 'select', ids: [] })}>
          <color attach="background" args={[theme.palette.mode === 'dark' ? '#5d7a99' : '#cfe3f5']} />
          <fog attach="fog" args={[theme.palette.mode === 'dark' ? '#5d7a99' : '#cfe3f5', bounds.radius * 8, bounds.radius * 30]} />
          <Lights bounds={bounds} />
          {mode === 'aerial' ? <AerialCamera bounds={bounds} fitRequest={fitRequest} /> : <ObserverCameraRig />}
          <mesh rotation-x={-Math.PI / 2} position={[bounds.center.x, -0.5, bounds.center.z]} receiveShadow>
            <planeGeometry args={[bounds.radius * 60, bounds.radius * 60]} />
            <meshStandardMaterial color="#8da379" />
          </mesh>
          <HomeScene home={home} selection={selection} selectionColor={theme.palette.primary.main} showCeilings={mode === 'observer'} />
        </Canvas>
      </Box>
    </Box>
  )
}
