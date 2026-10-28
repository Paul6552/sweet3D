import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, Vector3, type PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { ObserverCamera } from '../model/home'
import { dispatch, useEditorStore } from '../store/editorStore'

export interface SceneBounds {
  center: Vector3
  radius: number
}

const NEAR = 5
const FAR = 500000

/** Luftansicht: Orbit um das Projekt, nicht über den Boden hinaus. */
export function AerialCamera({ bounds, fitRequest }: { bounds: SceneBounds; fitRequest: number }) {
  // Kamera und Steuerung erst nach dem Registrieren als Standard (makeDefault) verwenden
  const camera = useThree((s) => s.camera) as ThreePerspectiveCamera
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])

  // Beim Start und auf „Alles zeigen“ das ganze Projekt schräg von oben zeigen
  useEffect(() => {
    if (!controls || !('fov' in camera)) return
    const { center, radius } = boundsRef.current
    const distance = (radius / Math.sin(MathUtils.degToRad(camera.fov / 2))) * 1.1
    camera.position.copy(center).add(new Vector3(-0.55, 0.75, 1).normalize().multiplyScalar(distance))
    controls.target.copy(center)
    controls.update()
  }, [fitRequest, camera, controls])

  return (
    <>
      <PerspectiveCamera makeDefault fov={45} near={NEAR} far={FAR} />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} enableDamping />
    </>
  )
}

const WALK_SPEED = 250 // cm/s
const TURN_SPEED = 1.5 // rad/s
const MOUSE_SENSITIVITY = 0.004
const SEND_INTERVAL_MS = 80

/**
 * Virtueller Besucher: W/S bzw. Pfeil hoch/runter gehen, A/D seitwärts, Pfeil links/rechts drehen,
 * Umschalt läuft schneller, Ziehen mit der Maus schaut umher. Die Position wird gedrosselt an das
 * Hauptfenster gemeldet, damit der Besucher im 2D-Plan (auch auf einem anderen Bildschirm) mitläuft.
 */
export function ObserverCameraRig() {
  const observer = useEditorStore((s) => s.home!.camera.observer)
  const { gl, size } = useThree()
  const camera = useRef<ThreePerspectiveCamera>(null)
  const local = useRef<ObserverCamera>({ ...observer })
  const keys = useRef(new Set<string>())
  // Losgelassene Tasten erst nach dem nächsten Frame entfernen, damit auch kurzes Antippen bewegt
  const released = useRef(new Set<string>())
  const lastSent = useRef(0)
  const unsent = useRef(false)

  // Änderungen von außen (z. B. im Plan verschoben) übernehmen, solange hier nichts bewegt wird
  useEffect(() => {
    if (!unsent.current) local.current = { ...observer }
  }, [observer])

  useEffect(() => {
    const element = gl.domElement
    // Fokussierbar machen, damit die Tastatur nur hier den Besucher steuert
    element.setAttribute('tabindex', '0')
    const onKeyDown = (event: KeyboardEvent) => {
      keys.current.add(event.code)
      released.current.delete(event.code)
      if (event.code.startsWith('Arrow')) event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent) => released.current.add(event.code)
    const onBlur = () => {
      keys.current.clear()
      released.current.clear()
    }
    let drag: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      element.focus()
      drag = { x: event.clientX, y: event.clientY }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.buttons === 0) return
      const o = local.current
      o.yaw += (event.clientX - drag.x) * MOUSE_SENSITIVITY
      o.pitch = MathUtils.clamp(o.pitch - (event.clientY - drag.y) * MOUSE_SENSITIVITY, -1.2, 1.2)
      drag = { x: event.clientX, y: event.clientY }
      unsent.current = true
    }
    const onPointerUp = () => (drag = null)
    element.addEventListener('keydown', onKeyDown)
    element.addEventListener('keyup', onKeyUp)
    element.addEventListener('blur', onBlur)
    element.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      element.removeEventListener('keydown', onKeyDown)
      element.removeEventListener('keyup', onKeyUp)
      element.removeEventListener('blur', onBlur)
      element.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [gl])

  useFrame((_, delta) => {
    const cam = camera.current
    if (!cam) return
    const pressed = (...codes: string[]) => (codes.some((c) => keys.current.has(c)) ? 1 : 0)
    const forward = pressed('KeyW', 'ArrowUp') - pressed('KeyS', 'ArrowDown')
    const strafe = pressed('KeyD') - pressed('KeyA')
    const turn = pressed('ArrowRight') - pressed('ArrowLeft')
    const o = local.current
    if (forward || strafe || turn) {
      const speed = WALK_SPEED * (keys.current.has('ShiftLeft') || keys.current.has('ShiftRight') ? 3 : 1) * delta
      o.yaw += turn * TURN_SPEED * delta
      o.x += (Math.cos(o.yaw) * forward - Math.sin(o.yaw) * strafe) * speed
      o.y += (Math.sin(o.yaw) * forward + Math.cos(o.yaw) * strafe) * speed
      unsent.current = true
    }
    for (const code of released.current) keys.current.delete(code)
    released.current.clear()

    // Plan (x, y) -> three (x, z), Augenhöhe -> y
    cam.position.set(o.x, o.z, o.y)
    const direction = new Vector3(Math.cos(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.sin(o.yaw) * Math.cos(o.pitch))
    cam.lookAt(cam.position.clone().add(direction))
    const verticalFov = MathUtils.radToDeg(2 * Math.atan(Math.tan(o.fieldOfView / 2) / (size.width / size.height || 1)))
    if (Math.abs(cam.fov - verticalFov) > 0.01) {
      cam.fov = verticalFov
      cam.updateProjectionMatrix()
    }

    const now = performance.now()
    if (unsent.current && now - lastSent.current > SEND_INTERVAL_MS) {
      lastSent.current = now
      unsent.current = false
      dispatch({
        type: 'camera',
        camera: { observer: { x: Math.round(o.x), y: Math.round(o.y), yaw: o.yaw, pitch: o.pitch } },
      })
    }
  })

  return <PerspectiveCamera ref={camera} makeDefault near={NEAR} far={FAR} />
}
