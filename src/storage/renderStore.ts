import type { AssetStore, StoredSnapshot } from '../view3d/photoPersist'
import { openDatabase } from './db'

/** A photo rendering in IndexedDB, see view3d/renderQueue. */
export interface StoredRenderJob {
  id: string
  /** Window that renders the job; a job whose window is gone can be taken over. */
  owner: string
  createdAt: number
  number: number
  size: number
  maxSamples: number
  denoise: boolean
  samples: number
  state: 'queued' | 'done' | 'error'
  preview: string | null
  /** Scene to render; dropped once the job has ended. */
  scene: StoredSnapshot | null
  /** Finished PNG. */
  result: Blob | null
}

/** State of the path tracer after a full pass, to continue from after a restart. */
export interface StoredCheckpoint {
  id: string
  samples: number
  /** Float RGBA values of the accumulated image. */
  pixels: Blob
}

const STORE_LOCK = 'sweet3d-render-store'

/**
 * Runs a task with exclusive access to the render stores across all windows. Otherwise cleaning up
 * could delete the assets of a job another window is just writing.
 */
export function withStoreLock<T>(task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(STORE_LOCK, task) as Promise<T>
}

export const renderAssets: AssetStore = {
  keys: async () => (await openDatabase()).getAllKeys('renderAssets'),
  putAll: async (assets) => {
    const db = await openDatabase()
    const transaction = db.transaction('renderAssets', 'readwrite')
    await Promise.all([...assets.map(([hash, blob]) => transaction.store.put(blob, hash)), transaction.done])
  },
}

export async function renderAsset(hash: string): Promise<Blob | undefined> {
  return (await openDatabase()).get('renderAssets', hash)
}

export async function listRenderJobs(): Promise<StoredRenderJob[]> {
  return (await openDatabase()).getAll('renderJobs')
}

export async function renderJob(id: string): Promise<StoredRenderJob | undefined> {
  return (await openDatabase()).get('renderJobs', id)
}

/** Written to disk before it returns: the system may shut down right after a job has finished. */
export async function putRenderJob(job: StoredRenderJob) {
  const db = await openDatabase()
  const transaction = db.transaction('renderJobs', 'readwrite', { durability: 'strict' })
  await Promise.all([transaction.store.put(job), transaction.done])
}

/** Makes {@code owner} the window that renders these jobs. */
export async function claimRenderJobs(jobs: StoredRenderJob[], owner: string) {
  const db = await openDatabase()
  const transaction = db.transaction('renderJobs', 'readwrite')
  await Promise.all([...jobs.map((job) => transaction.store.put({ ...job, owner })), transaction.done])
}

/** Stores a checkpoint unless its job is gone by now. */
export async function putRenderCheckpoint(checkpoint: StoredCheckpoint) {
  const db = await openDatabase()
  const transaction = db.transaction(['renderJobs', 'renderCheckpoints'], 'readwrite')
  if (await transaction.objectStore('renderJobs').getKey(checkpoint.id)) await transaction.objectStore('renderCheckpoints').put(checkpoint)
  await transaction.done
}

export async function renderCheckpoint(id: string): Promise<StoredCheckpoint | undefined> {
  return (await openDatabase()).get('renderCheckpoints', id)
}

export async function listRenderCheckpoints(): Promise<StoredCheckpoint[]> {
  return (await openDatabase()).getAll('renderCheckpoints')
}

/** Deletes a job with its image and checkpoint. */
export async function deleteRenderJob(id: string) {
  const db = await openDatabase()
  const transaction = db.transaction(['renderJobs', 'renderCheckpoints'], 'readwrite')
  await Promise.all([transaction.objectStore('renderJobs').delete(id), transaction.objectStore('renderCheckpoints').delete(id), transaction.done])
}

/** Assets no job needs any more. */
export function unusedAssets(assets: string[], jobs: Pick<StoredRenderJob, 'scene'>[]): string[] {
  const used = new Set(jobs.flatMap((job) => job.scene?.assets ?? []))
  return assets.filter((hash) => !used.has(hash))
}

/** Deletes everything no job refers to, also what an interrupted write has left behind. */
export async function collectRenderGarbage() {
  const db = await openDatabase()
  const [jobs, assets, checkpoints] = await Promise.all([db.getAll('renderJobs'), db.getAllKeys('renderAssets'), db.getAllKeys('renderCheckpoints')])
  // Only jobs with a scene can continue; an ended job has no use for its progress
  const resumable = new Set(jobs.filter((job) => job.scene).map((job) => job.id))
  const transaction = db.transaction(['renderAssets', 'renderCheckpoints'], 'readwrite')
  await Promise.all([
    ...unusedAssets(assets, jobs).map((hash) => transaction.objectStore('renderAssets').delete(hash)),
    ...checkpoints.filter((id) => !resumable.has(id)).map((id) => transaction.objectStore('renderCheckpoints').delete(id)),
    transaction.done,
  ])
}
