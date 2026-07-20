import { describe, expect, it } from 'vitest'
import { VIDEO_SCREEN_INTERVAL_MS, videoScreeningDelay } from './videoScreening'

describe('videoScreeningDelay re-export', () => {
  it('uses the shared core cadence', () => {
    expect(VIDEO_SCREEN_INTERVAL_MS).toBe(400)
    expect(videoScreeningDelay(0)).toBe(400)
    expect(videoScreeningDelay(5)).toBe(2_000)
  })
})
