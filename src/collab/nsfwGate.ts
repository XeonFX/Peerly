/**
 * This app's sensitive-media screen.
 *
 * Model loading, queueing and decoding live in `@peerly/core`. What stays here
 * is which model to load and how hard to work: this app screens a grid of call
 * tiles plus shared attachments, so it takes one job at a time and samples far
 * less often than a single-stream screen would.
 *
 * Frames never leave the device, and the screen fails open.
 */
import {
  createNsfwScreen,
  videoScreeningDelay as delayForCadence,
  type VideoScreeningCadence,
} from '@peerly/core'

export type { NsfwPrediction, NsfwScreenScanState } from '@peerly/core'
export {
  applyNsfwScanResult,
  CONSECUTIVE_CLEAN_TO_CLEAR,
  CONSECUTIVE_FLAGS_REQUIRED,
  INITIAL_NSFW_SCAN_STATE,
  shouldFlagNsfw,
} from '@peerly/core'

/**
 * Deliberately slower than core's single-stream default: every tile in a call
 * is screened, so a 400ms cadence would multiply across the grid.
 */
export const VIDEO_SCREEN_CADENCE: VideoScreeningCadence = {
  baseMs: 3_000,
  backoff: [[5, 10_000], [10, 30_000]],
}

export const VIDEO_SCREEN_INTERVAL_MS = VIDEO_SCREEN_CADENCE.baseMs

/** Core's schedule, bound to this app's cadence. */
export function videoScreeningDelay(cleanRuns: number): number {
  return delayForCadence(cleanRuns, VIDEO_SCREEN_CADENCE)
}

const screen = createNsfwScreen({
  // Serial: tiles are screened alongside an ongoing call, and GPU contention
  // shows up as dropped video frames.
  maxConcurrent: 1,
  loadClassifier: async () => {
    const [{ load }, { MobileNetV2Model }] = await Promise.all([
      import('nsfwjs/core'),
      import('nsfwjs/models/mobilenet_v2'),
    ])
    return load('MobileNetV2', { modelDefinitions: [MobileNetV2Model] })
  },
  onUnavailable: error => {
    console.warn('[Peerly] Sensitive-media screen unavailable; media was not classified:', error)
  },
})

export const isProbablyNsfwElement = screen.classifyElement
export const isProbablyNsfwMedia = screen.classifyMedia
export const isProbablyNsfwUrl = screen.classifyUrl
export const isProbablyNsfwUrlCached = screen.classifyUrlCached
