import { describe, expect, it } from 'vitest'
import {
  applyNsfwScanResult,
  CONSECUTIVE_CLEAN_TO_CLEAR,
  CONSECUTIVE_FLAGS_REQUIRED,
  INITIAL_NSFW_SCAN_STATE,
  shouldFlagNsfw,
  VIDEO_SCREEN_INTERVAL_MS,
  videoScreeningDelay,
} from './nsfwPolicy.js'

const prediction = (className: string, probability: number) => ({ className, probability })

describe('shouldFlagNsfw', () => {
  it('flags strong porn / hentai / sexy scores', () => {
    expect(shouldFlagNsfw([prediction('Porn', 0.8), prediction('Neutral', 0.1)])).toBe(true)
    expect(shouldFlagNsfw([prediction('Porn', 0.3), prediction('Hentai', 0.3)])).toBe(true)
    expect(shouldFlagNsfw([prediction('Sexy', 0.95)])).toBe(true)
  })

  it('allows clean or mild frames', () => {
    expect(shouldFlagNsfw([prediction('Neutral', 0.9), prediction('Drawing', 0.08)])).toBe(false)
    expect(shouldFlagNsfw([prediction('Sexy', 0.5), prediction('Neutral', 0.4)])).toBe(false)
    expect(shouldFlagNsfw([])).toBe(false)
  })
})

describe('video screen policy constants', () => {
  it('samples sub-second for flash reaction', () => {
    expect(VIDEO_SCREEN_INTERVAL_MS).toBeLessThanOrEqual(500)
    expect(VIDEO_SCREEN_INTERVAL_MS).toBeGreaterThanOrEqual(200)
    expect(CONSECUTIVE_FLAGS_REQUIRED).toBe(1)
    expect(CONSECUTIVE_CLEAN_TO_CLEAR).toBe(3)
  })
})

describe('applyNsfwScanResult', () => {
  it('flags on the first NSFW hit and clears after three clean', () => {
    let state = applyNsfwScanResult(INITIAL_NSFW_SCAN_STATE, true)
    expect(state.flagged).toBe(true)
    state = applyNsfwScanResult(state, false)
    state = applyNsfwScanResult(state, false)
    expect(state.flagged).toBe(true)
    state = applyNsfwScanResult(state, false)
    expect(state).toEqual(INITIAL_NSFW_SCAN_STATE)
  })
})

describe('videoScreeningDelay', () => {
  it('starts at base then backs off', () => {
    expect(videoScreeningDelay(0)).toBe(400)
    expect(videoScreeningDelay(5)).toBe(2_000)
    expect(videoScreeningDelay(15)).toBe(8_000)
    expect(videoScreeningDelay(30)).toBe(20_000)
  })
})
