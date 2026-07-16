/**
 * Local sensitive-media screen.
 *
 * TensorFlow, NSFWJS, and the MobileNetV2 weights are loaded only when visual
 * media first needs checking. A single promise queue prevents several file or
 * live-video tiles from running inference concurrently and fighting for the
 * main thread/GPU. Frames never leave the device and sampled video frames are
 * not persisted.
 */

type VisualSource = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
type Classifier = {
  classify: (source: VisualSource) => Promise<NsfwPrediction[]>
}

let classifierPromise: Promise<Classifier> | null = null
let inferenceQueue: Promise<unknown> = Promise.resolve()

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

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = inferenceQueue.then(job, job)
  inferenceQueue = next.catch(() => undefined)
  return next
}

function canvasFrom(source: VisualSource): HTMLCanvasElement | null {
  const width =
    source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.width
  const height =
    source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.height
  if (!width || !height) return null
  const scale = Math.min(1, 224 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
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
