import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from './joinRoom.js'
import { createRoomMedia } from './roomMedia.js'

function fakeTrack(kind: 'audio' | 'video', id: string): MediaStreamTrack {
  return { enabled: true, kind, id, readyState: 'live', stop: vi.fn() } as unknown as MediaStreamTrack
}

function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: 'initial-stream',
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(track => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter(track => track.kind === 'video'),
  } as unknown as MediaStream
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createRoomMedia', () => {
  it('publishes the initial capture as a stream so onPeerStream receives it', async () => {
    const stream = fakeStream([fakeTrack('audio', 'audio-1'), fakeTrack('video', 'video-1')])
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    const addStream = vi.fn()
    const addTrack = vi.fn()
    const room = {
      addStream,
      addTrack,
      removeTrack: vi.fn(),
      replaceTrack: vi.fn(),
    } as unknown as Room

    const media = createRoomMedia(room, vi.fn())
    await media.enableCamera()

    expect(addStream).toHaveBeenCalledOnce()
    expect(addStream).toHaveBeenCalledWith(stream)
    expect(addTrack).not.toHaveBeenCalled()
  })
})
