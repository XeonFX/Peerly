/**
 * Live video NSFW sampling cadence — aligned with HeyHubs defaults.
 * Base interval ~400ms while actively scanning; back off after long clean runs
 * so multi-hour calls do not thrash the main thread.
 */

/** Same practical floor as HeyHubs (MobileNetV2 classify often 50–200ms). */
export const VIDEO_SCREEN_INTERVAL_MS = 400

/**
 * Increasing backoff after clean frames keeps long calls responsive.
 * First ticks stay at VIDEO_SCREEN_INTERVAL_MS for flash reaction.
 */
export function videoScreeningDelay(cleanRuns: number): number {
  if (cleanRuns < 5) return VIDEO_SCREEN_INTERVAL_MS
  if (cleanRuns < 15) return 2_000
  if (cleanRuns < 30) return 8_000
  return 20_000
}
