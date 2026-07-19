import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyAudioOutput,
  audioOutputSelectionSupported,
  inferJoinMode,
} from './mediaDevices.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('mediaDevices', () => {
  it('detects setSinkId support as a boolean', () => {
    expect(typeof audioOutputSelectionSupported()).toBe('boolean')
  })

  it('applies setSinkId when available', async () => {
    const setSinkId = vi.fn(async () => {})
    vi.stubGlobal('HTMLMediaElement', {
      prototype: { setSinkId: async () => {} },
    })
    const el = { setSinkId } as unknown as HTMLMediaElement
    await applyAudioOutput(el, 'headphones')
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
  })

  it('returns audio when only audio tracks are live', () => {
    const stream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [{ readyState: 'live' }],
    } as unknown as MediaStream
    expect(inferJoinMode(stream)).toBe('audio')
  })

  it('returns audio when video tracks are ended', () => {
    const stream = {
      getVideoTracks: () => [{ readyState: 'ended' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    } as unknown as MediaStream
    expect(inferJoinMode(stream)).toBe('audio')
  })

  it('returns video when a video track is live', () => {
    const stream = {
      getVideoTracks: () => [{ readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    } as unknown as MediaStream
    expect(inferJoinMode(stream)).toBe('video')
  })
})
