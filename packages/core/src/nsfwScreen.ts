import {
  canvasFromVisualSource,
  createInferencePool,
  shouldFlagNsfw,
  type NsfwPrediction,
  type VisualSource,
} from './nsfwPolicy.js'

/**
 * Running the sensitive-media screen: model loading, work queueing, and
 * turning whatever the caller has — an element, a decoded buffer, a preview
 * URL — into something the classifier can look at.
 *
 * Frames never leave the device, and every path fails *open*: a screen that
 * cannot run must not block media, because it is advisory rather than a
 * content firewall.
 *
 * The classifier is injected rather than imported. Both apps load the same
 * model the same way, but the model is a heavyweight dependency and a package
 * this size should not force it on every consumer.
 */
export type NsfwClassifier = {
  classify(source: VisualSource): Promise<NsfwPrediction[]>
}

export type NsfwScreenConfig = {
  /** Called at most once; the resolved classifier is reused. */
  loadClassifier(): Promise<NsfwClassifier>
  /** Concurrent classify jobs. Lower it when screening many tiles at once. */
  maxConcurrent?: number
  /** Reports a screen that could not run. Media is passed through regardless. */
  onUnavailable?(error: unknown): void
}

export type NsfwScreen = {
  /** Classifies a live element — a video tile, an image already in the DOM. */
  classifyElement(source: VisualSource): Promise<boolean>
  /** Classifies decoded bytes. Videos are sampled at start, middle and end. */
  classifyMedia(buffer: ArrayBuffer, mimeType: string): Promise<boolean>
  classifyUrl(url: string): Promise<boolean>
  /**
   * As `classifyUrl`, but one verdict per file id for the lifetime of the
   * page: the same attachment is rendered in many places, and classifying is
   * far more expensive than remembering.
   */
  classifyUrlCached(fileId: string, url: string): Promise<boolean>
}

/** Fractions of the duration to sample. One frame is easy to get past. */
const VIDEO_SAMPLE_POINTS = [0.1, 0.5, 0.9]

async function decodeImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Image failed to decode'))
    image.src = url
  })
  return image
}

async function seek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.01) return
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error('Video seek failed'))
    video.currentTime = time
  })
}

export function createNsfwScreen(config: NsfwScreenConfig): NsfwScreen {
  const pool = createInferencePool(config.maxConcurrent)
  const canvasCache = new WeakMap<VisualSource, HTMLCanvasElement>()
  const verdictByFileId = new Map<string, Promise<boolean>>()
  let classifier: Promise<NsfwClassifier> | null = null

  function loadOnce(): Promise<NsfwClassifier> {
    classifier ??= config.loadClassifier()
    return classifier
  }

  function unavailable(error: unknown): false {
    config.onUnavailable?.(error)
    return false
  }

  async function classifyElement(source: VisualSource): Promise<boolean> {
    try {
      return await pool.enqueue(async () => {
        const canvas = canvasFromVisualSource(source, canvasCache)
        // Dimensions not ready yet — nothing to judge.
        if (!canvas) return false
        return shouldFlagNsfw(await (await loadOnce()).classify(canvas))
      })
    } catch (error) {
      return unavailable(error)
    }
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
      const times = duration > 0 ? VIDEO_SAMPLE_POINTS.map(at => duration * at) : [0]
      for (const time of times) {
        // Stay clear of the very end, where a seek may never resolve.
        await seek(video, Math.max(0, Math.min(time, Math.max(0, duration - 0.05))))
        if (await classifyElement(video)) return true
      }
      return false
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function classifyUrl(url: string): Promise<boolean> {
    try {
      return await classifyElement(await decodeImage(url))
    } catch {
      // A preview that will not decode cannot be shown either.
      return false
    }
  }

  return {
    classifyElement,
    classifyUrl,

    async classifyMedia(buffer, mimeType) {
      try {
        if (mimeType.startsWith('video/')) return await classifyVideoBuffer(buffer, mimeType)
        if (!mimeType.startsWith('image/')) return false
        const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }))
        try {
          return await classifyElement(await decodeImage(url))
        } finally {
          URL.revokeObjectURL(url)
        }
      } catch (error) {
        return unavailable(error)
      }
    },

    classifyUrlCached(fileId, url) {
      const pending = verdictByFileId.get(fileId)
      if (pending) return pending
      const verdict = classifyUrl(url)
      verdictByFileId.set(fileId, verdict)
      // A rejection must not be cached as a permanent verdict.
      verdict.catch(() => verdictByFileId.delete(fileId))
      return verdict
    },
  }
}
