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

describe('audio output preference', () => {
  it('persists preferred sink id', () => {
    savePreferredAudioOutput('sink-1')
    expect(loadPreferredAudioOutput()).toBe('sink-1')
    savePreferredAudioOutput('')
    expect(loadPreferredAudioOutput()).toBe('')
  })

  it('detects setSinkId support as a boolean', () => {
    expect(typeof audioOutputSelectionSupported()).toBe('boolean')
  })

  it('applies setSinkId when available', async () => {
    const setSinkId = vi.fn(async () => {})
    vi.stubGlobal('HTMLMediaElement', {
      prototype: { setSinkId: async () => {} },
    })
    const el = { setSinkId } as unknown as HTMLMediaElement
    savePreferredAudioOutput('headphones')
    await applyAudioOutput(el)
    expect(setSinkId).toHaveBeenCalledWith('headphones')
  })

  it('no-ops when setSinkId is missing', async () => {
    vi.stubGlobal('HTMLMediaElement', { prototype: {} })
    const setSinkId = vi.fn(async () => {})
    const el = { setSinkId } as unknown as HTMLMediaElement
    await applyAudioOutput(el, 'sink-x')
    expect(setSinkId).not.toHaveBeenCalled()
  })
})

describe('inferJoinMode', () => {
  it('defaults to video when no stream', () => {
    expect(inferJoinMode(null)).toBe('video')
    expect(inferJoinMode(undefined)).toBe('video')
  })

  it('returns audio when stream has only audio tracks', () => {
    const stream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [{ readyState: 'live' }],
    } as unknown as MediaStream
    expect(inferJoinMode(stream)).toBe('audio')
  })

  it('returns video when stream has a live video track', () => {
    const stream = {
      getVideoTracks: () => [{ readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    } as unknown as MediaStream
    expect(inferJoinMode(stream)).toBe('video')
  })
})
