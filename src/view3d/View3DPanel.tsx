import CameraAlt from '@mui/icons-material/CameraAlt'
import DirectionsWalk from '@mui/icons-material/DirectionsWalk'
import FitScreen from '@mui/icons-material/FitScreen'
import HighQuality from '@mui/icons-material/HighQuality'
import ThreeDRotation from '@mui/icons-material/ThreeDRotation'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ACESFilmicToneMapping, type Fog, Object3D, PCFShadowMap, Vector3 } from 'three'
import type { CameraMode, Home } from '../model/home'
import { visibleLevels } from '../model/levels'
import { homeBounds } from '../plan/hitTest'
import { dispatch, useEditorStore } from '../store/editorStore'
import { AerialCamera, ObserverCameraRig, type SceneBounds } from './cameras'
import { Ground, Sky } from './Environment'
import { HORIZON, SUN_DIRECTION } from './sky'
import { useEditorContext } from '../editor/EditorContext'
import { PanelToolbar } from '../editor/PanelFrame'
import { HomeScene } from './HomeScene'
import { PhotoDialog, type SceneHandle } from './PhotoDialog'
import { QUALITIES, QUALITY_PROFILES, type QualityProfile, useQualityStore } from './quality'
import { ThumbnailRecorder } from './ThumbnailRecorder'

function sceneBounds(home: Home): SceneBounds {
  const b = homeBounds(home) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  // Oberkante der obersten sichtbaren Ebene
  const top = Math.max(...visibleLevels(home).map((l) => (l ? l.elevation + l.height : home.wallHeight)))
  const center = new Vector3((b.minX + b.maxX) / 2, top / 3, (b.minY + b.maxY) / 2)
  const radius = Math.max(b.maxX - b.minX, b.maxY - b.minY, top) / 2 + 100
  return { center, radius }
}

/**
 * Tageslicht: das Umgebungslicht kommt vom Himmel (siehe Sky), dazu eine Sonne mit Schatten.
 * Der Schattenbereich umfasst nur das Projekt, damit die Schatten scharf genug sind.
 */
function Lights({ bounds, profile }: { bounds: SceneBounds; profile: QualityProfile }) {
  const { center, radius } = bounds
  const sun = center.clone().addScaledVector(SUN_DIRECTION, radius * 3)
  const extent = radius * 1.05
  // Das Ziel muss in der Szene liegen (nicht als Kind des Lichts), sonst zeigt die Sonne in eine falsche Richtung
  const target = useMemo(() => new Object3D(), [])
  return (
    <>
      <primitive object={target} position={center} />
      {/* Nur ein Hauch, falls das Umgebungslicht noch berechnet wird */}
      <hemisphereLight args={['#e8f1ff', '#8a7f6a', 0.15]} />
      <directionalLight
        // Neue Schattenkarte, wenn sich die Auflösung ändert
        key={profile.shadowMapSize}
        position={sun}
        color="#fff3e2"
        intensity={2.4}
        castShadow
        shadow-mapSize={[profile.shadowMapSize, profile.shadowMapSize]}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-near={radius}
        shadow-camera-far={radius * 5}
        shadow-bias={-0.0002}
        shadow-normalBias={0.6}
        shadow-radius={3}
        target={target}
      />
    </>
  )
}

/** AO und Bloom wie in Spiele-Engines; filmisches Tonemapping (ACES) wie in Unreal. */
function Effects({ profile }: { profile: QualityProfile }) {
  if (!profile.ao && !profile.bloom) return null
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={60} distanceFalloff={0.6} intensity={2.2} halfRes={profile.aoHalfRes} quality={profile.aoHalfRes ? 'medium' : 'high'} />
      <>{profile.bloom && <Bloom mipmapBlur luminanceThreshold={1} intensity={0.25} />}</>
      <SMAA />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}

/**
 * Dunst ab etwas hinter dem Projekt, gemessen von der Kamera: so bleibt das Projekt aus jeder
 * Entfernung klar und nur der Boden zum Horizont hin verschwimmt.
 */
function Haze({ bounds }: { bounds: SceneBounds }) {
  const fog = useRef<Fog>(null)
  useFrame(({ camera }) => {
    if (!fog.current) return
    const near = camera.position.distanceTo(bounds.center) + bounds.radius * 2
    fog.current.near = near
    fog.current.far = near + Math.max(bounds.radius * 20, 60000)
  })
  return <fog ref={fog} attach="fog" args={[HORIZON, 4000, 60000]} />
}

/** Ohne WebGL (z. B. vom Browser nach Grafikfehlern gesperrt) nur einen Hinweis statt den Editor abstürzen lassen. */
class WebGLBoundary extends Component<{ message: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Typography color="text.secondary" sx={{ p: 3 }}>
        {this.props.message}
      </Typography>
    )
  }
}

/** Gibt Szene und Kamera für den Foto-Modus frei. */
function SceneRegistry({ onChange }: { onChange: (handle: SceneHandle) => void }) {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => onChange({ scene, camera }), [onChange, scene, camera])
  return null
}

/** 3D-Ansicht mit Luftansicht und virtuellem Besucher (Modus wird mit dem Plan synchronisiert). */
export function View3DPanel() {
  const { t } = useTranslation()
  const theme = useTheme()
  const { projectId } = useEditorContext()
  const home = useEditorStore((s) => s.home)
  const selection = useEditorStore((s) => s.selection)
  const [fitRequest, setFitRequest] = useState(0)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [qualityMenu, setQualityMenu] = useState<HTMLElement | null>(null)
  const quality = useQualityStore((s) => s.quality)
  const setQuality = useQualityStore((s) => s.setQuality)
  const profile = QUALITY_PROFILES[quality]
  const sceneHandle = useRef<SceneHandle | null>(null)
  const registerScene = useCallback((handle: SceneHandle) => {
    sceneHandle.current = handle
  }, [])
  // Nur bei Änderungen der Geometrie neu berechnen, nicht bei jeder Kamerabewegung
  const walls = home?.walls
  const furniture = home?.furniture
  const rooms = home?.rooms
  const wallHeight = home?.wallHeight
  const levels = home?.levels
  const level = home?.selectedLevel
  const bounds = useMemo(
    () =>
      sceneBounds({
        walls: walls ?? [],
        furniture: furniture ?? [],
        rooms: rooms ?? [],
        // Maßlinien und Texte gibt es in 3D nicht
        dimensionLines: [],
        labels: [],
        wallHeight: wallHeight ?? 250,
        levels: levels ?? [],
        selectedLevel: level ?? null,
      } as unknown as Home),
    [walls, furniture, rooms, wallHeight, levels, level],
  )
  if (!home) return null
  const mode = home.camera.mode

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }} data-view3d>
      <PanelToolbar>
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
        <Tooltip title={t('view3d.quality')}>
          <IconButton size="small" onClick={(e) => setQualityMenu(e.currentTarget)} aria-label={t('view3d.quality')}>
            <HighQuality fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={qualityMenu} open={!!qualityMenu} onClose={() => setQualityMenu(null)}>
          {QUALITIES.map((q) => (
            <MenuItem
              key={q}
              selected={q === quality}
              onClick={() => {
                setQuality(q)
                setQualityMenu(null)
              }}
            >
              {t(`view3d.qualities.${q}`)}
            </MenuItem>
          ))}
        </Menu>
        <Tooltip title={t('photo.title')}>
          <IconButton size="small" onClick={() => setPhotoOpen(true)} aria-label={t('photo.title')}>
            <CameraAlt fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 1, flex: '1 1 0', minWidth: 0 }}>
          {t(mode === 'aerial' ? 'view3d.aerialHint' : 'view3d.observerHint')}
        </Typography>
      </PanelToolbar>
      <PhotoDialog open={photoOpen} onClose={() => setPhotoOpen(false)} handle={() => sceneHandle.current} />
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', '& canvas': { outline: 'none' } }}>
        {/* Logarithmische Tiefe: Böden knapp über dem Rasen flackern sonst schon aus mittlerer Entfernung */}
        <WebGLBoundary message={t('view3d.noWebGL')}>
          <Canvas
            shadows={{ enabled: true, type: PCFShadowMap }}
            dpr={profile.dpr}
            // Während des Fotos nicht live rendern, damit die Grafikkarte ganz dem Pathtracer gehört
            frameloop={photoOpen ? 'never' : 'always'}
            gl={{ antialias: true, logarithmicDepthBuffer: true, toneMapping: ACESFilmicToneMapping }}
            onPointerMissed={() => dispatch({ type: 'select', ids: [] })}
          >
            <color attach="background" args={[HORIZON]} />
            <Haze bounds={bounds} />
            <Sky environmentSize={profile.environmentSize} />
            <Lights bounds={bounds} profile={profile} />
            {mode === 'aerial' ? <AerialCamera bounds={bounds} fitRequest={fitRequest} /> : <ObserverCameraRig />}
            <Ground />
            <HomeScene home={home} selection={selection} selectionColor={theme.palette.primary.main} showCeilings={mode === 'observer'} />
            <ThumbnailRecorder projectId={projectId} home={home} />
            <SceneRegistry onChange={registerScene} />
            <Effects profile={profile} />
          </Canvas>
        </WebGLBoundary>
      </Box>
    </Box>
  )
}
