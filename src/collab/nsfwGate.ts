/**
 * Peerly NSFW screen: loads NSFWJS locally; pure policy/pool/canvas live in
 * @peerly/core. Frames never leave the device. Fails open (returns false).
 */

import {
  canvasFromVisualSource,
  createInferencePool,
  shouldFlagNsfw,
  type NsfwPrediction,
  type VisualSource,
} from '@peerly/core'

export type { NsfwPrediction }
export {
  applyNsfwScanResult,
  CONSECUTIVE_CLEAN_TO_CLEAR,
  CONSECUTIVE_FLAGS_REQUIRED,
  INITIAL_NSFW_SCAN_STATE,
  shouldFlagNsfw,
  VIDEO_SCREEN_INTERVAL_MS,
  videoScreeningDelay,
  type NsfwScreenScanState,
} from '@peerly/core'

type Classifier = {
  classify: (source: VisualSource) => Promise<NsfwPrediction[]>
}

let classifierPromise: Promise<Classifier> | null = null
const pool = createInferencePool()
const canvasCache = new WeakMap<VisualSource, HTMLCanvasElement>()

function loadClassifier(): Promise<Classifier> {
  classifierPromise ??= (async () => {
    const [{ load }, { MobileNetV2Model }] = await Promise.all([
      import('nsfwjs/core'),
      import('nsfwjs/models/mobilenet_v2'),
    ])
    return load('MobileNetV2', { modelDefinitions: [MobileNetV2Model] })
  })()
  return classifierPromise
}

export async function isProbablyNsfwElement(source: VisualSource): Promise<boolean> {
  try {
    return await pool.enqueue(async () => {
      const canvas = canvasFromVisualSource(source, canvasCache)
      if (!canvas) return false
      return shouldFlagNsfw(await (await loadClassifier()).classify(canvas))
    })
  } catch (error) {
    console.warn('[Peerly] Sensitive-media screen unavailable; media was not classified:', error)
    return false
  }
}

async function bufferToImage(buffer: ArrayBuffer, mimeType: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image failed to decode'))
      image.src = url
    })
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function seek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.01) return
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error('Video seek failed'))
    video.currentTime = time
  })
}

async function classifyVideoBuffer(buffer: ArrayBuffer, mimeType: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }))
  try {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Video failed to decode'))
    })
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const times = duration > 0 ? [duration * 0.1, duration * 0.5, duration * 0.9] : [0]
    for (const time of times) {
      await seek(video, Math.max(0, Math.min(time, Math.max(0, duration - 0.05))))
      if (await isProbablyNsfwElement(video)) return true
    }
    return false
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function isProbablyNsfwMedia(buffer: ArrayBuffer, mimeType: string): Promise<boolean> {
  try {
    if (mimeType.startsWith('video/')) return classifyVideoBuffer(buffer, mimeType)
    if (!mimeType.startsWith('image/')) return false
    return isProbablyNsfwElement(await bufferToImage(buffer, mimeType))
  } catch (error) {
    console.warn('[Peerly] Sensitive-media screen unavailable; media was not classified:', error)
    return false
  }
}

const verdictByFileId = new Map<string, Promise<boolean>>()

export function isProbablyNsfwUrlCached(fileId: string, url: string): Promise<boolean> {
  let pending = verdictByFileId.get(fileId)
  if (!pending) {
    pending = isProbablyNsfwUrl(url)
    verdictByFileId.set(fileId, pending)
    pending.catch(() => verdictByFileId.delete(fileId))
  }
  return pending
}

export async function isProbablyNsfwUrl(url: string): Promise<boolean> {
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Preview failed to decode'))
      image.src = url
    })
    return isProbablyNsfwElement(image)
  } catch {
    return false
  }
}
