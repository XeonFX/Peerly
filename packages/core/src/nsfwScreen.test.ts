import { describe, expect, it, vi } from 'vitest'
import { createNsfwScreen, type NsfwClassifier } from './nsfwScreen.js'
import { LIVE_VIDEO_CADENCE, videoScreeningDelay } from './nsfwPolicy.js'

/**
 * The screen is advisory. Every way it can fail has to end with the media
 * being shown, because the alternative is a broken model silently hiding
 * everything a user tries to send.
 *
 * The classification path itself needs a canvas, so it is exercised in the
 * apps' browser environments rather than here; what this covers is the
 * decisions made around it.
 */

function screenWith(classifier: Partial<NsfwClassifier>, onUnavailable = vi.fn()) {
  return {
    onUnavailable,
    screen: createNsfwScreen({
      loadClassifier: async () => classifier as NsfwClassifier,
      onUnavailable,
    }),
  }
}

describe('createNsfwScreen', () => {
  it('passes media through when the model will not load', async () => {
    const onUnavailable = vi.fn()
    const screen = createNsfwScreen({
      loadClassifier: async () => { throw new Error('offline') },
      onUnavailable,
    })
    expect(await screen.classifyElement({} as never)).toBe(false)
    expect(onUnavailable).toHaveBeenCalled()
  })

  it('passes media through when classification throws', async () => {
    const { screen, onUnavailable } = screenWith({
      classify: async () => { throw new Error('backend lost') },
    })
    expect(await screen.classifyMedia(new ArrayBuffer(4), 'image/png')).toBe(false)
    expect(onUnavailable).toHaveBeenCalled()
  })

  it('ignores media it has no way to look at', async () => {
    const classify = vi.fn()
    const { screen } = screenWith({ classify })
    expect(await screen.classifyMedia(new ArrayBuffer(4), 'application/pdf')).toBe(false)
    expect(classify).not.toHaveBeenCalled()
  })

  it('classifies a file once and reuses the verdict', async () => {
    // The same attachment renders in many places; classifying is far more
    // expensive than remembering.
    const decodes = vi.fn()
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        decodes()
        queueMicrotask(() => this.onerror?.())
      }
    })
    const { screen } = screenWith({ classify: async () => [] })
    await screen.classifyUrlCached('file-1', 'blob:one')
    await screen.classifyUrlCached('file-1', 'blob:one')
    expect(decodes).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('videoScreeningDelay', () => {
  it('backs off as a stream stays clean', () => {
    expect(videoScreeningDelay(0)).toBe(LIVE_VIDEO_CADENCE.baseMs)
    expect(videoScreeningDelay(4)).toBe(LIVE_VIDEO_CADENCE.baseMs)
    expect(videoScreeningDelay(5)).toBe(2_000)
    expect(videoScreeningDelay(15)).toBe(8_000)
    expect(videoScreeningDelay(30)).toBe(20_000)
    expect(videoScreeningDelay(10_000)).toBe(20_000)
  })

  it('follows a caller-supplied cadence', () => {
    // An app screening a grid of tiles trades first-verdict latency for CPU.
    const grid = { baseMs: 3_000, backoff: [[5, 10_000], [10, 30_000]] } as const
    expect(videoScreeningDelay(0, grid)).toBe(3_000)
    expect(videoScreeningDelay(5, grid)).toBe(10_000)
    expect(videoScreeningDelay(10, grid)).toBe(30_000)
    expect(videoScreeningDelay(999, grid)).toBe(30_000)
  })

  it('never speeds up as a stream stays clean longer', () => {
    let previous = 0
    for (let runs = 0; runs < 60; runs++) {
      const delay = videoScreeningDelay(runs)
      expect(delay).toBeGreaterThanOrEqual(previous)
      previous = delay
    }
  })
})
