import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyAudioOutput,
  audioOutputSelectionSupported,
  inferJoinMode,
  loadPreferredAudioOutput,
  savePreferredAudioOutput,
} from './deviceSelection'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('audio output preference (Peerly keys)', () => {
  it('persists preferred sink id', () => {
    savePreferredAudioOutput('sink-1')
    expect(loadPreferredAudioOutput()).toBe('sink-1')
    savePreferredAudioOutput('')
    expect(loadPreferredAudioOutput()).toBe('')
  })

  it('applies preferred sink via core helper', async () => {
    const setSinkId = vi.fn(async () => {})
    vi.stubGlobal('HTMLMediaElement', {
      prototype: { setSinkId: async () => {} },
    })
    const el = { setSinkId } as unknown as HTMLMediaElement
    savePreferredAudioOutput('headphones')
    await applyAudioOutput(el)
    expect(setSinkId).toHaveBeenCalledWith('headphones')
    expect(typeof audioOutputSelectionSupported()).toBe('boolean')
  })
})

describe('inferJoinMode re-export', () => {
  it('returns audio for ended-only video', () => {
    const stream = {
      getVideoTracks: () => [{ readyState: 'ended' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    } as unknown as MediaStream
    expect(inferJoinMode(stream)).toBe('audio')
  })
})
