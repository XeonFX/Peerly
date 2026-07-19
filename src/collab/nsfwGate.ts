/**
 * Local sensitive-media screen.
 *
 * TensorFlow, NSFWJS, and MobileNetV2 load lazily. Inference uses a small
 * concurrency pool (aligned with HeyHubs) so multi-tile calls stay responsive
 * without unbounded GPU load. Frames never leave the device.
 */

type VisualSource = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
type Classifier = {
  classify: (source: VisualSource) => Promise<NsfwPrediction[]>
}

let classifierPromise: Promise<Classifier> | null = null

/** Same pool limit as HeyHubs — serial was too slow for multi-tile calls. */
const MAX_CONCURRENT_INFERENCES = 3
let activeInferences = 0
const inferenceWaiters: Array<() => void> = []

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

export type NsfwPrediction = { className: string; probability: number }

export function shouldFlagNsfw(predictions: NsfwPrediction[]): boolean {
  const byClass = new Map(predictions.map(prediction => [prediction.className, prediction.probability]))
  const explicit = (byClass.get('Porn') ?? 0) + (byClass.get('Hentai') ?? 0)
  const suggestive = byClass.get('Sexy') ?? 0
  return explicit >= 0.55 || suggestive >= 0.85
}

async function enqueue<T>(job: () => Promise<T>): Promise<T> {
  if (activeInferences >= MAX_CONCURRENT_INFERENCES) {
    await new Promise<void>(resolve => inferenceWaiters.push(resolve))
  }
  activeInferences++
  try {
    return await job()
  } finally {
    activeInferences--
    inferenceWaiters.shift()?.()
  }
}

/** One canvas per element, reused across scan ticks (HeyHubs). */
const canvasCache = new WeakMap<VisualSource, HTMLCanvasElement>()

function canvasFrom(source: VisualSource): HTMLCanvasElement | null {
  const width =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : source.width
  const height =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : source.height
  if (!width || !height) return null
  const scale = Math.min(1, 224 / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  let canvas = canvasCache.get(source)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvasCache.set(source, canvas)
  }
  if (canvas.width !== targetWidth) canvas.width = targetWidth
  if (canvas.height !== targetHeight) canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export async function isProbablyNsfwElement(source: VisualSource): Promise<boolean> {
  try {
    return await enqueue(async () => {
      const canvas = canvasFrom(source)
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

/**
 * One verdict per file id, ever, per page. File ids are content hashes, so a
 * verdict can never go stale; without this every channel switch re-ran
 * inference over every visible image (50 images = 50 inferences per visit).
 * Callers should also persist the verdict onto the message so future sessions
 * skip the model entirely.
 */
const verdictByFileId = new Map<string, Promise<boolean>>()

export function isProbablyNsfwUrlCached(fileId: string, url: string): Promise<boolean> {
  let pending = verdictByFileId.get(fileId)
  if (!pending) {
    pending = isProbablyNsfwUrl(url)
    verdictByFileId.set(fileId, pending)
    // A transient failure (decode error mid-load) must not pin false forever.
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
