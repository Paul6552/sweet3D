import type { TFunction } from 'i18next'
import { create } from 'zustand'
import {
  claimRenderJobs,
  collectRenderGarbage,
  deleteRenderJob,
  listRenderCheckpoints,
  listRenderJobs,
  putRenderCheckpoint,
  putRenderJob,
  renderAsset,
  renderAssets,
  renderCheckpoint,
  renderJob,
  type StoredRenderJob,
  withStoreLock,
} from '../storage/renderStore'
import { useEditorStore } from '../store/editorStore'
import { captureSnapshot, type CapturedSnapshot, restoreSnapshot, type StoredSnapshot, storeAssets } from './photoPersist'
import {
  PHOTO_SIZES,
  type PhotoCheckpoint,
  type PhotoRun,
  QUALITY_KEYS,
  renderPhoto,
  SAMPLE_OPTIONS,
  type PhotoSnapshot,
  type SceneHandle,
  snapshotPhotoScene,
} from './photoRender'

export type RenderJobState = 'queued' | 'preparing' | 'rendering' | 'done' | 'error'

/**
 * A photo rendering requested from the 3D view; rendered one after another in the background. Jobs
 * are kept in IndexedDB until they are removed from the list, so they survive a browser restart.
 */
export interface RenderJob {
  id: string
  createdAt: number
  /** Running number, for the file name. */
  number: number
  size: number
  maxSamples: number
  /** Filter the remaining noise out of the finished image. */
  denoise: boolean
  samples: number
  state: RenderJobState
  /** Small image of the 3D view when the job was queued (JPEG data URL). */
  preview: string | null
  /** Canvas of the running path tracer; null otherwise. */
  canvas: HTMLCanvasElement | null
  /** Object URL of the finished PNG. */
  result: string | null
  /** Taken over from storage: its scene is a copy that shares nothing with the 3D view. */
  restored: boolean
}

interface RenderQueueState {
  jobs: RenderJob[]
  /** The 3D view of this window offers a scene to photograph. */
  sceneAvailable: boolean
  /** Photo dialog: open, and the job it shows (null: settings for a new job). */
  dialog: { open: boolean; jobId: string | null }
  /** Counts jobs that could not be stored, so the UI can show a notice. */
  notSaved: number
}

export const useRenderQueue = create<RenderQueueState>(() => ({
  jobs: [],
  sceneAvailable: false,
  dialog: { open: false, jobId: null },
  notSaved: 0,
}))

/** Identifies this window's lock on the model at the editor main window. */
const WINDOW_ID = crypto.randomUUID()
const PREVIEW_WIDTH = 192
const PREVIEW_HEIGHT = 108
/** Held as long as a window lives, which tells other windows whose jobs have lost their window. */
const OWNER_LOCK = 'sweet3d-render-owner-'

let sceneHandle: SceneHandle | null = null
let counter = 0
/** Snapshots of jobs not yet rendered; kept outside the store because they are large and mutable. */
const snapshots = new Map<string, PhotoSnapshot>()
/** The running job's path tracer: finish the image early, or stop and free its GPU resources. */
let running: PhotoRun | null = null

/** Writes of this window, one after another; a later change of a job never overtakes an earlier one. */
let storing: Promise<unknown> = Promise.resolve()

function store(task: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
  const result = storing.then(() => withStoreLock(task)).catch(onError)
  storing = result
  return result
}

/** The job then renders in this session as usual, but is lost when the browser closes. */
function reportNotSaved(error: unknown) {
  console.warn('Photo: rendering could not be stored', error)
  useRenderQueue.setState((s) => ({ notSaved: s.notSaved + 1 }))
}

function stored(target: RenderJob, state: StoredRenderJob['state'], scene: StoredSnapshot | null, result: Blob | null): StoredRenderJob {
  const { id, createdAt, number, size, maxSamples, denoise, samples, preview } = target
  return { id, owner: WINDOW_ID, createdAt, number, size, maxSamples, denoise, samples, preview, state, scene, result }
}

/** The job record comes last, so a stored job always has all of its assets. */
function storeNewJob(id: string, captured: CapturedSnapshot) {
  // Without this the browser may evict the data when disk space gets low
  void navigator.storage?.persist?.()
  void store(async () => {
    await storeAssets(captured, renderAssets)
    const current = job(id)
    if (current) await putRenderJob(stored(current, 'queued', captured.manifest, null))
  }, reportNotSaved)
}

/** Keeps only what the ended job still needs: its image, not its scene and progress. */
function storeEndedJob(id: string, state: 'done' | 'error', result: Blob | null) {
  void store(async () => {
    const current = job(id)
    if (!current) return
    await putRenderJob(stored(current, state, null, result))
    await collectRenderGarbage()
  }, reportNotSaved)
}

function saveCheckpoint(id: string, { samples, pixels }: PhotoCheckpoint): Promise<void> {
  return store(
    async () => {
      if (job(id)?.state === 'rendering') await putRenderCheckpoint({ id, samples, pixels: new Blob([pixels as BlobPart]) })
    },
    // Only costs progress on a restart; the next checkpoint tries again
    (error) => console.warn('Photo: progress could not be saved', error),
  )
}

/** Scene and progress of a job that was taken over from storage. */
async function loadStoredJob(target: RenderJob): Promise<{ snapshot: PhotoSnapshot; resume: PhotoCheckpoint | null }> {
  const record = await renderJob(target.id)
  if (!record?.scene) throw new Error(`Rendering ${target.id} has no stored scene`)
  const snapshot = await restoreSnapshot(record.scene, renderAsset)
  const checkpoint = await renderCheckpoint(target.id)
  if (!checkpoint) return { snapshot, resume: null }
  const { width, height } = PHOTO_SIZES[target.size]
  const pixels = new Float32Array(await checkpoint.pixels.arrayBuffer())
  return { snapshot, resume: pixels.length === width * height * 4 ? { samples: checkpoint.samples, pixels } : null }
}

function restoredJob(record: StoredRenderJob, samples: number | undefined): RenderJob {
  const { id, createdAt, number, size, maxSamples, denoise, state, preview, result } = record
  return {
    id,
    createdAt,
    number,
    size,
    maxSamples,
    denoise,
    state,
    preview,
    samples: samples ?? record.samples,
    canvas: null,
    result: result && URL.createObjectURL(result),
    restored: true,
  }
}

/** Takes over all jobs that have lost their window, e.g. through a browser restart. */
async function adoptStoredJobs() {
  await new Promise<void>((granted) => {
    void navigator.locks.request(OWNER_LOCK + WINDOW_ID, () => {
      granted()
      return new Promise(() => {})
    })
  })
  const adopted = await withStoreLock(async () => {
    const { held = [] } = await navigator.locks.query()
    const alive = new Set(held.map((lock) => lock.name))
    const records = (await listRenderJobs()).filter((record) => !alive.has(OWNER_LOCK + record.owner))
    await claimRenderJobs(records, WINDOW_ID)
    await collectRenderGarbage()
    const samples = new Map((await listRenderCheckpoints()).map((checkpoint) => [checkpoint.id, checkpoint.samples]))
    return records.sort((a, b) => a.createdAt - b.createdAt).map((record) => restoredJob(record, samples.get(record.id)))
  })
  counter = Math.max(counter, ...adopted.map((j) => j.number))
  useRenderQueue.setState((s) => ({ jobs: [...adopted, ...s.jobs] }))
  pump()
}

let started = false

/**
 * Called by the window that shows the queue. Windows without it must not take over jobs: nobody
 * would see them, and the queue module is also loaded in windows of other panels.
 */
export function startRenderQueue() {
  if (started) return
  started = true
  adoptStoredJobs().catch((error: unknown) => console.warn('Photo: stored renderings could not be loaded', error))
}

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
export function enqueuePhoto(size: number, maxSamples: number, denoise: boolean): string | null {
  if (!sceneHandle) return null
  const id = crypto.randomUUID()
  const snapshot = snapshotPhotoScene(sceneHandle.scene, sceneHandle.camera)
  snapshots.set(id, snapshot)
  const added: RenderJob = {
    id,
    createdAt: Date.now(),
    number: ++counter,
    size,
    maxSamples,
    denoise,
    samples: 0,
    state: 'queued',
    preview: previewImage(sceneHandle),
    canvas: null,
    result: null,
    restored: false,
  }
  useRenderQueue.setState((s) => ({ jobs: [...s.jobs, added] }))
  try {
    storeNewJob(id, captureSnapshot(snapshot))
  } catch (error) {
    reportNotSaved(error)
  }
  pump()
  return id
}

function releaseSnapshot(id: string) {
  snapshots.get(id)?.dispose()
  snapshots.delete(id)
}

/** Ends the running job: frees the GPU and starts the next one. */
function endRunning(id: string, change: Partial<RenderJob>) {
  running?.stop()
  running = null
  releaseSnapshot(id)
  update(id, { ...change, canvas: null })
  pump()
}

/** Keeps the current image of the running job as its result. */
function finishRunning(id: string) {
  const current = job(id)
  if (!current?.canvas) return
  running?.finish()
  current.canvas.toBlob((blob) => {
    if (!job(id)) return
    if (blob) {
      endRunning(id, { state: 'done', result: URL.createObjectURL(blob) })
      storeEndedJob(id, 'done', blob)
    } else failRunning(id)
  }, 'image/png')
}

function failRunning(id: string) {
  endRunning(id, { state: 'error' })
  storeEndedJob(id, 'error', null)
}

/** Starts the next queued job when none is running. */
function pump() {
  const { jobs } = useRenderQueue.getState()
  if (jobs.some((j) => j.state === 'preparing' || j.state === 'rendering')) return
  const next = jobs.find((j) => j.state === 'queued' && (j.restored || snapshots.has(j.id)))
  if (!next) return
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = 'auto'
  canvas.style.display = 'block'
  update(next.id, { state: 'preparing', canvas })
  if (!next.restored) {
    update(next.id, { samples: 0 })
    start(next, snapshots.get(next.id)!, null, canvas)
    return
  }
  // Loaded only now: a scene can be large, so only the running job keeps one in memory
  loadStoredJob(next).then(
    ({ snapshot, resume }) => {
      if (job(next.id)?.state === 'preparing') {
        snapshots.set(next.id, snapshot)
        start(next, snapshot, resume, canvas)
      } else snapshot.dispose() // Cancelled in the meantime
    },
    (error: unknown) => {
      console.warn('Photo: stored rendering could not be loaded', error)
      if (job(next.id)?.state === 'preparing') failRunning(next.id)
    },
  )
}

function start(target: RenderJob, snapshot: PhotoSnapshot, resume: PhotoCheckpoint | null, canvas: HTMLCanvasElement) {
  const { width, height } = PHOTO_SIZES[target.size]
  const { id } = target
  running = renderPhoto(
    snapshot,
    canvas,
    width,
    height,
    target.maxSamples,
    target.denoise,
    {
      onState: (state) => update(id, { state }),
      onProgress: (samples) => update(id, { samples }),
      onCheckpoint: (checkpoint) => saveCheckpoint(id, checkpoint),
      onDone: () => finishRunning(id),
      onError: () => failRunning(id),
    },
    resume,
  )
}

/** Stops a running job early and keeps the image so far; without any pass it is removed. */
export function stopJob(id: string) {
  const current = job(id)
  if (!current) return
  if (current.state === 'rendering' && current.samples > 0) finishRunning(id)
  else removeJob(id)
}

/** Removes a job from the list and its image from storage; a running one is cancelled. */
export function removeJob(id: string) {
  const current = job(id)
  if (!current) return
  if (current.state === 'preparing' || current.state === 'rendering') {
    running?.stop()
    running = null
  }
  releaseSnapshot(id)
  if (current.result) URL.revokeObjectURL(current.result)
  useRenderQueue.setState((s) => ({
    jobs: s.jobs.filter((j) => j.id !== id),
    dialog: s.dialog.jobId === id ? { open: false, jobId: null } : s.dialog,
  }))
  void store(
    async () => {
      await deleteRenderJob(id)
      await collectRenderGarbage()
    },
    (error) => console.warn('Photo: rendering could not be deleted', error),
  )
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
// with the live scene. The lock is held at the editor main window, per window with jobs. Restored
// jobs have their own copy of the scene and leave the model free.
let locked = false
const sendLock = (value: boolean) => useEditorStore.getState().dispatch({ type: 'renderLock', owner: WINDOW_ID, locked: value })
useRenderQueue.subscribe((state) => {
  const pending = state.jobs.some((j) => isPending(j) && !j.restored)
  if (pending === locked) return
  locked = pending
  sendLock(pending)
})
// A reloaded main window has forgotten the lock
useEditorStore.subscribe((state, previous) => {
  if (locked && state.connection === 'connected' && previous.connection !== 'connected') sendLock(true)
})
window.addEventListener('pagehide', () => locked && sendLock(false))

// Keep the screen awake while jobs are pending, so the system does not lock or sleep mid-render.
// The browser drops the wake lock when the page gets hidden; it is requested again once visible.
let wakeLock: WakeLockSentinel | null = null
let wantWakeLock = false
async function requestWakeLock() {
  if (!wantWakeLock || wakeLock || document.hidden || !('wakeLock' in navigator)) return
  try {
    const sentinel = await navigator.wakeLock.request('screen')
    if (!wantWakeLock) {
      void sentinel.release()
      return
    }
    wakeLock = sentinel
    sentinel.addEventListener('release', () => {
      if (wakeLock === sentinel) wakeLock = null
    })
  } catch {
    // Not allowed (e.g. no user activation, battery saver): rendering works without it
  }
}
useRenderQueue.subscribe((state) => {
  const pending = state.jobs.some(isPending)
  if (pending === wantWakeLock) return
  wantWakeLock = pending
  if (pending) void requestWakeLock()
  else {
    void wakeLock?.release()
    wakeLock = null
  }
})
document.addEventListener('visibilitychange', () => void requestWakeLock())
