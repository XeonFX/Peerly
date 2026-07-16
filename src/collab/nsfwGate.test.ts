import { describe, expect, it } from 'vitest'
import { shouldFlagNsfw } from './nsfwGate'

const prediction = (className: string, probability: number) => ({ className, probability })

describe('shouldFlagNsfw', () => {
  it('flags dominant explicit classes', () => {
    expect(shouldFlagNsfw([prediction('Porn', 0.8), prediction('Neutral', 0.1)])).toBe(true)
    expect(shouldFlagNsfw([prediction('Porn', 0.3), prediction('Hentai', 0.3)])).toBe(true)
    expect(shouldFlagNsfw([prediction('Sexy', 0.95)])).toBe(true)
  })

  it('passes ordinary content', () => {
    expect(shouldFlagNsfw([prediction('Neutral', 0.9), prediction('Drawing', 0.08)])).toBe(false)
    expect(shouldFlagNsfw([prediction('Sexy', 0.5), prediction('Neutral', 0.4)])).toBe(false)
    expect(shouldFlagNsfw([])).toBe(false)
  })
})
