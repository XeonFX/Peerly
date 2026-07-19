import { describe, expect, it } from 'vitest'
import { shouldFlagNsfw } from './nsfwGate'

const prediction = (className: string, probability: number) => ({ className, probability })

describe('shouldFlagNsfw re-export', () => {
  it('flags dominant explicit classes', () => {
    expect(shouldFlagNsfw([prediction('Porn', 0.8), prediction('Neutral', 0.1)])).toBe(true)
    expect(shouldFlagNsfw([prediction('Sexy', 0.95)])).toBe(true)
  })

  it('passes ordinary content', () => {
    expect(shouldFlagNsfw([prediction('Neutral', 0.9)])).toBe(false)
  })
})
