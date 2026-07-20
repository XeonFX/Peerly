/**
 * Pure NSFW screening policy shared by consumer apps.
 *
 * Does NOT load NSFWJS or TensorFlow — apps own the model dependency and
 * inject classify(). This module is thresholds, concurrency, canvas downsample,
 * and live-tile streak policy only.
 */

export type NsfwPrediction = { className: string; probability: number }

/** Sum of Porn+Hentai at or above this → flag. */
export const NSFW_EXPLICIT_THRESHOLD = 0.55
/** Sexy class alone at or above this → flag. */
export const NSFW_SUGGESTIVE_THRESHOLD = 0.85

/**
 * Max concurrent classify jobs. 3 balances multi-tile latency vs GPU thrash
 * while avoiding excessive GPU contention.
 */
export const NSFW_MAX_CONCURRENT_INFERENCES = 3

/** Target long edge when downsampling for MobileNetV2. */
export const NSFW_CANVAS_MAX_EDGE = 224

export function shouldFlagNsfw(predictions: NsfwPrediction[]): boolean {
  const byClass = new Map(predictions.map(p => [p.className, p.probability]))
  const explicit = (byClass.get('Porn') ?? 0) + (byClass.get('Hentai') ?? 0)
  const suggestive = byClass.get('Sexy') ?? 0
  return explicit >= NSFW_EXPLICIT_THRESHOLD || suggestive >= NSFW_SUGGESTIVE_THRESHOLD
}

export type InferencePool = {
  enqueue: <T>(job: () => Promise<T>) => Promise<T>
}

/** Concurrency-limited job queue for model inference. */
export function createInferencePool(
  maxConcurrent: number = NSFW_MAX_CONCURRENT_INFERENCES
): InferencePool {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError('maxConcurrent must be a positive integer')
  }
  let active = 0
  const waiters: Array<() => void> = []
  return {
    enqueue: async job => {
      if (active >= maxConcurrent) {
        await new Promise<void>(resolve => waiters.push(resolve))
      }
      active++
      try {
        return await job()
      } finally {
        active--
        waiters.shift()?.()
      }
    },
  }
}

export type VisualSource = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement

/**
 * Downsample a visual source onto a cached canvas (one canvas per element).
 * Returns null if dimensions are not ready.
 */
export function canvasFromVisualSource(
  source: VisualSource,
  cache: WeakMap<VisualSource, HTMLCanvasElement> = new WeakMap(),
  maxEdge: number = NSFW_CANVAS_MAX_EDGE
): HTMLCanvasElement | null {
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
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  let canvas = cache.get(source)
  if (!canvas) {
    canvas = document.createElement('canvas')
    cache.set(source, canvas)
  }
  if (canvas.width !== targetWidth) canvas.width = targetWidth
  if (canvas.height !== targetHeight) canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** How often to sample a live tile while actively screening (~MobileNet floor). */
export const VIDEO_SCREEN_INTERVAL_MS = 400

/** Blur as soon as one frame scores NSFW. */
export const CONSECUTIVE_FLAGS_REQUIRED = 1

/** Clean frames required to clear blur (~1.2s at 400ms). */
export const CONSECUTIVE_CLEAN_TO_CLEAR = 3

export type NsfwScreenScanState = {
  flagged: boolean
  positiveStreak: number
  cleanStreak: number
}

export const INITIAL_NSFW_SCAN_STATE: NsfwScreenScanState = {
  flagged: false,
  positiveStreak: 0,
  cleanStreak: 0,
}

/**
 * Pure policy: one classification → next blur/streak state.
 * Shared by consumer video components and Peerly call tiles.
 */
export function applyNsfwScanResult(
  state: NsfwScreenScanState,
  isNsfw: boolean
): NsfwScreenScanState {
  if (isNsfw) {
    if (state.flagged) {
      return { flagged: true, positiveStreak: 0, cleanStreak: 0 }
    }
    const positiveStreak = state.positiveStreak + 1
    if (positiveStreak >= CONSECUTIVE_FLAGS_REQUIRED) {
      return { flagged: true, positiveStreak: 0, cleanStreak: 0 }
    }
    return { flagged: false, positiveStreak, cleanStreak: 0 }
  }

  if (state.flagged) {
    const cleanStreak = state.cleanStreak + 1
    if (cleanStreak >= CONSECUTIVE_CLEAN_TO_CLEAR) {
      return INITIAL_NSFW_SCAN_STATE
    }
    return { flagged: true, positiveStreak: 0, cleanStreak }
  }
  return INITIAL_NSFW_SCAN_STATE
}

/**
 * Live-scan cadence with backoff after long clean runs so multi-hour calls
 * do not thrash the main thread.
 */
export function videoScreeningDelay(
  cleanRuns: number,
  baseMs: number = VIDEO_SCREEN_INTERVAL_MS
): number {
  if (cleanRuns < 5) return baseMs
  if (cleanRuns < 15) return 2_000
  if (cleanRuns < 30) return 8_000
  return 20_000
}
