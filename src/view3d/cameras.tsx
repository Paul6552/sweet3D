import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, Plane, Raycaster, Vector2, Vector3, type Mesh, type PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { wheelDelta } from '../editor/wheel'
import type { ObserverCamera } from '../model/home'
import { isUnderground, levelElevation, selectedLevel } from '../model/levels'
import { dispatch, useEditorStore } from '../store/editorStore'

export interface SceneBounds {
  center: Vector3
  radius: number
}

const NEAR = 5
const FAR = 400000

/** Anteil des Abstands zum Punkt unter der Maus, um den ein Rastschritt (100 px) heranfährt. */
const ZOOM_STEP = 0.15
/** Kleinster Schritt in cm, damit das Heranfahren in der Nähe nicht beliebig langsam wird. */
const MIN_ZOOM_STEP = 15
/** So nah fährt die Kamera höchstens an eine getroffene Fläche heran (nicht hindurch). */
const MIN_SURFACE_DISTANCE = 20

/**
 * Luftansicht: Orbit um das Projekt, nicht unter die Höhe des Drehpunkts. Beim Wechsel der Ebene
 * wandert der Drehpunkt mit der Kamera auf die Höhe der Ebene; bei Untergeschossen liegt er unter
 * dem Gelände, sodass man von der Seite durch die Erde hineinsieht (der Rasen ist von unten unsichtbar).
 */
export function AerialCamera({ bounds, fitRequest }: { bounds: SceneBounds; fitRequest: number }) {
  // Kamera und Steuerung erst nach dem Registrieren als Standard (makeDefault) verwenden
  const camera = useThree((s) => s.camera) as ThreePerspectiveCamera
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])
  const level = useEditorStore((s) => s.home!.selectedLevel)
  const underground = useEditorStore((s) => isUnderground(selectedLevel(s.home!)))
  const floor = useEditorStore((s) => levelElevation(s.home!, s.home!.selectedLevel))
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  // Mausrad: zum Punkt unter der Maus fahren statt zum festen Drehpunkt. Kamera und Drehpunkt
  // wandern gemeinsam, daher bleibt man nicht vor dem Drehpunkt hängen; in der Nähe wird der Schritt
  // kleiner, aber nie kleiner als MIN_ZOOM_STEP, und vor getroffenen Flächen hält die Kamera an.
  useEffect(() => {
    if (!controls) return
    const element = gl.domElement
    const raycaster = new Raycaster()
    const ground = new Plane()
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const steps = -wheelDelta(event, rect.height) / 100
      if (steps === 0) return
      const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      // Himmel (nur Hintergrund) nicht treffen; ausgeblendete Teile liegen auf einer anderen Schicht
      const hit = raycaster.intersectObjects(scene.children, true).find((h) => h.object.visible && h.object.userData.photo !== false && (h.object as Mesh).isMesh)
      let distance = hit?.distance
      if (distance === undefined) {
        ground.set(new Vector3(0, 1, 0), -floor)
        const point = raycaster.ray.intersectPlane(ground, new Vector3())
        if (point) distance = point.distanceTo(raycaster.ray.origin)
      }
      const hasHit = distance !== undefined
      distance ??= camera.position.distanceTo(controls.target)

      let move: number
      if (steps > 0) {
        move = Math.max(distance * (1 - Math.pow(1 - ZOOM_STEP, steps)), MIN_ZOOM_STEP * steps)
        if (hasHit) move = Math.min(move, distance - MIN_SURFACE_DISTANCE)
        if (move <= 0) return
      } else {
        move = -distance * (Math.pow(1 - ZOOM_STEP, steps) - 1)
        const { center, radius } = boundsRef.current
        const maxDistance = Math.max(radius * 6, 3000)
        const room = maxDistance - camera.position.distanceTo(center)
        if (room <= 0) return
        move = Math.max(move, -room)
      }
      const shift = raycaster.ray.direction.clone().multiplyScalar(move)
      camera.position.add(shift)
      controls.target.add(shift)
      // Drehpunkt auf der Blickrichtung in die Tiefe der angesehenen Fläche legen, damit danach um
      // das gedreht wird, was man ansieht (die Blickrichtung ändert sich dabei nicht)
      if (hasHit) {
        const view = controls.target.clone().sub(camera.position).normalize()
        controls.target.copy(camera.position).addScaledVector(view, Math.max(distance - move, MIN_SURFACE_DISTANCE * 5))
      }
      controls.update()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [gl, scene, camera, controls, floor])

  // Andere Ebene gewählt: Drehpunkt und Kamera gemeinsam auf deren Höhe schieben, der Blickwinkel bleibt
  const shownLevel = useRef(level)
  useEffect(() => {
    if (!controls || shownLevel.current === level) return
    shownLevel.current = level
    const shift = new Vector3(0, boundsRef.current.center.y - controls.target.y, 0)
    controls.target.add(shift)
    camera.position.add(shift)
    controls.update()
  }, [level, camera, controls])

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
      {/* Über dem Gelände nicht unter den Rasen; bei Untergeschossen bis knapp unter die Waagerechte */}
      <OrbitControls makeDefault maxPolarAngle={underground ? Math.PI / 2 + 0.3 : Math.PI / 2 - 0.02} enableDamping enableZoom={false} />
    </>
  )
}

const WALK_SPEED = 250 // cm/s
const TURN_SPEED = 1.5 // rad/s
const MOUSE_SENSITIVITY = 0.004
const SEND_INTERVAL_MS = 200

/**
 * Virtueller Besucher: W/S bzw. Pfeil hoch/runter gehen, A/D seitwärts, Pfeil links/rechts drehen,
 * Umschalt läuft schneller, Ziehen mit der Maus schaut umher. Die Position wird gedrosselt an das
 * Hauptfenster gemeldet, damit der Besucher im 2D-Plan (auch auf einem anderen Bildschirm) mitläuft.
 */
export function ObserverCameraRig() {
  const observer = useEditorStore((s) => s.home!.camera.observer)
  // Augenhöhe gilt über dem Fußboden der gewählten Ebene
  const floor = useEditorStore((s) => levelElevation(s.home!, s.home!.selectedLevel))
  const { gl, size } = useThree()
  const camera = useRef<ThreePerspectiveCamera>(null)
  const local = useRef<ObserverCamera>({ ...observer })
  const keys = useRef(new Set<string>())
  // Losgelassene Tasten erst nach dem nächsten Frame entfernen, damit auch kurzes Antippen bewegt
  const released = useRef(new Set<string>())
  const lastSent = useRef(0)
  const unsent = useRef(false)
  const sent = useRef<Pick<ObserverCamera, 'x' | 'y' | 'yaw' | 'pitch'> | null>(null)

  // Änderungen von außen (z. B. im Plan verschoben) übernehmen, solange hier nichts bewegt wird.
  // Das Echo der eigenen Meldung (gerundet und schon veraltet) würde die Kamera zurückspringen lassen.
  useEffect(() => {
    const own = sent.current
    if (own && own.x === observer.x && own.y === observer.y && own.yaw === observer.yaw && own.pitch === observer.pitch) {
      local.current = { ...local.current, z: observer.z, fieldOfView: observer.fieldOfView }
      return
    }
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
    cam.position.set(o.x, floor + o.z, o.y)
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
      sent.current = { x: Math.round(o.x), y: Math.round(o.y), yaw: o.yaw, pitch: o.pitch }
      dispatch({ type: 'camera', camera: { observer: sent.current } })
    }
  })

  return <PerspectiveCamera ref={camera} makeDefault near={NEAR} far={FAR} />
}
