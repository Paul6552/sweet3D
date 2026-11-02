import type { TFunction } from 'i18next'
import { create } from 'zustand'
import { useEditorStore } from '../store/editorStore'
import { PHOTO_SIZES, QUALITY_KEYS, renderPhoto, SAMPLE_OPTIONS, type PhotoSnapshot, type SceneHandle, snapshotPhotoScene } from './photoRender'

export type RenderJobState = 'queued' | 'preparing' | 'rendering' | 'done' | 'error'

/** A photo rendering requested from the 3D view; rendered one after another in the background. */
export interface RenderJob {
  id: string
  /** Running number in this session, for the file name. */
  number: number
  size: number
  maxSamples: number
  samples: number
  state: RenderJobState
  /** Small image of the 3D view when the job was queued (JPEG data URL). */
  preview: string | null
  /** Canvas of the running path tracer; null otherwise. */
  canvas: HTMLCanvasElement | null
  /** Object URL of the finished PNG. */
  result: string | null
}

interface RenderQueueState {
  jobs: RenderJob[]
  /** The 3D view of this window offers a scene to photograph. */
  sceneAvailable: boolean
  /** Photo dialog: open, and the job it shows (null: settings for a new job). */
  dialog: { open: boolean; jobId: string | null }
}

export const useRenderQueue = create<RenderQueueState>(() => ({
  jobs: [],
  sceneAvailable: false,
  dialog: { open: false, jobId: null },
}))

/** Identifies this window's lock on the model at the editor main window. */
const WINDOW_ID = crypto.randomUUID()
const PREVIEW_WIDTH = 192
const PREVIEW_HEIGHT = 108

let sceneHandle: SceneHandle | null = null
let counter = 0
/** Snapshots of jobs not yet rendered; kept outside the store because they are large and mutable. */
const snapshots = new Map<string, PhotoSnapshot>()
/** Stops the running job and frees its GPU resources. */
let stopRunning: (() => void) | null = null

/** Registered by the 3D view; null when it unmounts. */
export function setSceneHandle(handle: SceneHandle | null) {
  sceneHandle = handle
  useRenderQueue.setState({ sceneAvailable: handle !== null })
}

export function openPhotoDialog(jobId: string | null = null) {
  useRenderQueue.setState({ dialog: { open: true, jobId } })
}

export function closePhotoDialog() {
  useRenderQueue.setState((s) => ({ dialog: { ...s.dialog, open: false } }))
}

export function isPending(job: RenderJob): boolean {
  return job.state === 'queued' || job.state === 'preparing' || job.state === 'rendering'
}

/** Share of the job that is done, 0 to 1. */
export function jobProgress(job: RenderJob): number {
  if (job.state === 'done') return 1
  return Math.min(1, job.samples / job.maxSamples)
}

/** Size and quality of a job, e.g. "Full HD · Gut". */
export function jobLabel(job: RenderJob, t: TFunction): string {
  return `${PHOTO_SIZES[job.size].label} · ${t(QUALITY_KEYS[Math.max(0, SAMPLE_OPTIONS.indexOf(job.maxSamples))])}`
}

function update(id: string, change: Partial<RenderJob>) {
  useRenderQueue.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...change } : j)) }))
}

function job(id: string): RenderJob | undefined {
  return useRenderQueue.getState().jobs.find((j) => j.id === id)
}

/** Center crop of the live 3D view in the aspect ratio of the photo. */
function previewImage({ gl, scene, camera }: SceneHandle): string | null {
  try {
    // Right after rendering the drawing buffer is still filled (without preserveDrawingBuffer)
    gl.render(scene, camera)
    const source = gl.domElement
    if (source.width === 0 || source.height === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = PREVIEW_WIDTH
    canvas.height = PREVIEW_HEIGHT
    const scale = Math.min(source.width / PREVIEW_WIDTH, source.height / PREVIEW_HEIGHT)
    const w = PREVIEW_WIDTH * scale
    const h = PREVIEW_HEIGHT * scale
    canvas.getContext('2d')?.drawImage(source, (source.width - w) / 2, (source.height - h) / 2, w, h, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}

/**
 * Queues a photo of the current 3D view. Camera, sun and visible levels are captured now, so the
 * view can be changed for the next job right away. Returns the job id, or null without a 3D view.
 */
export function enqueuePhoto(size: number, maxSamples: number): string | null {
  if (!sceneHandle) return null
  const id = crypto.randomUUID()
  snapshots.set(id, snapshotPhotoScene(sceneHandle.scene, sceneHandle.camera))
  const added: RenderJob = {
    id,
    number: ++counter,
    size,
    maxSamples,
    samples: 0,
    state: 'queued',
    preview: previewImage(sceneHandle),
    canvas: null,
    result: null,
  }
  useRenderQueue.setState((s) => ({ jobs: [...s.jobs, added] }))
  pump()
  return id
}

function releaseSnapshot(id: string) {
  snapshots.get(id)?.dispose()
  snapshots.delete(id)
}

/** Ends the running job: frees the GPU and starts the next one. */
function endRunning(id: string, change: Partial<RenderJob>) {
  stopRunning?.()
  stopRunning = null
  releaseSnapshot(id)
  update(id, { ...change, canvas: null })
  pump()
}

/** Keeps the current image of the running job as its result. */
function finishRunning(id: string) {
  const current = job(id)
  if (!current?.canvas) return
  current.canvas.toBlob((blob) => {
    if (!job(id)) return
    if (blob) endRunning(id, { state: 'done', result: URL.createObjectURL(blob) })
    else endRunning(id, { state: 'error' })
  }, 'image/png')
}

/** Starts the next queued job when none is running. */
function pump() {
  const { jobs } = useRenderQueue.getState()
  if (jobs.some((j) => j.state === 'preparing' || j.state === 'rendering')) return
  const next = jobs.find((j) => j.state === 'queued')
  const snapshot = next && snapshots.get(next.id)
  if (!next || !snapshot) return
  const { width, height } = PHOTO_SIZES[next.size]
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = 'auto'
  canvas.style.display = 'block'
  update(next.id, { state: 'preparing', canvas, samples: 0 })
  stopRunning = renderPhoto(snapshot, canvas, width, height, next.maxSamples, {
    onState: (state) => update(next.id, { state }),
    onProgress: (samples) => update(next.id, { samples }),
    onDone: () => finishRunning(next.id),
    onError: () => endRunning(next.id, { state: 'error' }),
  })
}

/** Stops a running job early and keeps the image so far; without any pass it is removed. */
export function stopJob(id: string) {
  const current = job(id)
  if (!current) return
  if (current.state === 'rendering' && current.samples > 0) finishRunning(id)
  else removeJob(id)
}

/** Removes a job from the list; a running one is cancelled. */
export function removeJob(id: string) {
  const current = job(id)
  if (!current) return
  if (current.state === 'preparing' || current.state === 'rendering') {
    stopRunning?.()
    stopRunning = null
  }
  releaseSnapshot(id)
  if (current.result) URL.revokeObjectURL(current.result)
  useRenderQueue.setState((s) => ({
    jobs: s.jobs.filter((j) => j.id !== id),
    dialog: s.dialog.jobId === id ? { open: false, jobId: null } : s.dialog,
  }))
  pump()
}

/** Removes all finished and failed jobs. */
export function clearFinished() {
  useRenderQueue
    .getState()
    .jobs.filter((j) => !isPending(j))
    .forEach((j) => removeJob(j.id))
}

/** Saves the finished image (or the current state of a running one) as PNG. */
export function downloadJob(target: RenderJob) {
  const save = (url: string, revoke: boolean) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `foto-${target.number}.png`
    a.click()
    if (revoke) URL.revokeObjectURL(url)
  }
  if (target.result) save(target.result, false)
  else target.canvas?.toBlob((blob) => blob && save(URL.createObjectURL(blob), true), 'image/png')
}

// The model must not change while jobs are pending: their snapshots share geometries and materials
// with the live scene. The lock is held at the editor main window, per window with jobs.
let locked = false
const sendLock = (value: boolean) => useEditorStore.getState().dispatch({ type: 'renderLock', owner: WINDOW_ID, locked: value })
useRenderQueue.subscribe((state) => {
  const pending = state.jobs.some(isPending)
  if (pending === locked) return
  locked = pending
  sendLock(pending)
})
// A reloaded main window has forgotten the lock
useEditorStore.subscribe((state, previous) => {
  if (locked && state.connection === 'connected' && previous.connection !== 'connected') sendLock(true)
})
window.addEventListener('pagehide', () => locked && sendLock(false))
