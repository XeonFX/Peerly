import { describe, expect, it } from 'vitest'
import { VIDEO_SCREEN_INTERVAL_MS, videoScreeningDelay } from './videoScreening'

describe('videoScreeningDelay', () => {
  it('starts at HeyHubs-aligned base interval then backs off', () => {
    expect(VIDEO_SCREEN_INTERVAL_MS).toBe(400)
    expect(videoScreeningDelay(0)).toBe(400)
    expect(videoScreeningDelay(4)).toBe(400)
    expect(videoScreeningDelay(5)).toBe(2_000)
    expect(videoScreeningDelay(14)).toBe(2_000)
    expect(videoScreeningDelay(15)).toBe(8_000)
    expect(videoScreeningDelay(30)).toBe(20_000)
  })
})
