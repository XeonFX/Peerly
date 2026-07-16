import { describe, expect, it } from 'vitest'
import { videoScreeningDelay } from './videoScreening'

describe('videoScreeningDelay', () => {
  it('backs off from active screening to settled-call intervals', () => {
    expect(videoScreeningDelay(0)).toBe(3_000)
    expect(videoScreeningDelay(4)).toBe(3_000)
    expect(videoScreeningDelay(5)).toBe(10_000)
    expect(videoScreeningDelay(9)).toBe(10_000)
    expect(videoScreeningDelay(10)).toBe(30_000)
    expect(videoScreeningDelay(100)).toBe(30_000)
  })
})
