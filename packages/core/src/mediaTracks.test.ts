import { describe, expect, it } from 'vitest'
import { isReplaceOnlyUpgrade, planTrackOps } from './mediaTracks.js'

function fakeTrack(kind: 'audio' | 'video', id: string): MediaStreamTrack {
  return { kind, id, stop: () => {} } as unknown as MediaStreamTrack
}

function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: 'stream',
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
  } as unknown as MediaStream
}

describe('planTrackOps', () => {
  it('adds all tracks when going from silence to a stream', () => {
    const audio = fakeTrack('audio', 'a1')
    const video = fakeTrack('video', 'v1')
    const next = fakeStream([audio, video])
    const ops = planTrackOps(null, next)
    expect(ops).toEqual([
      { op: 'add', kind: 'audio', track: audio, stream: next },
      { op: 'add', kind: 'video', track: video, stream: next },
    ])
  })

  it('removes all tracks when stopping media', () => {
    const audio = fakeTrack('audio', 'a1')
    const prev = fakeStream([audio])
    expect(planTrackOps(prev, null)).toEqual([{ op: 'remove', kind: 'audio', track: audio }])
  })

  it('uses replace for audio when upgrading mic-only to camera (plus add video)', () => {
    const oldAudio = fakeTrack('audio', 'a1')
    const newAudio = fakeTrack('audio', 'a2')
    const newVideo = fakeTrack('video', 'v1')
    const prev = fakeStream([oldAudio])
    const next = fakeStream([newAudio, newVideo])
    const ops = planTrackOps(prev, next)
    expect(ops).toContainEqual({
      op: 'replace',
      kind: 'audio',
      oldTrack: oldAudio,
      newTrack: newAudio,
    })
    expect(ops).toContainEqual({ op: 'add', kind: 'video', track: newVideo, stream: next })
    expect(isReplaceOnlyUpgrade(ops)).toBe(false)
  })

  it('is replace-only when swapping devices of the same shape', () => {
    const a1 = fakeTrack('audio', 'a1')
    const v1 = fakeTrack('video', 'v1')
    const a2 = fakeTrack('audio', 'a2')
    const v2 = fakeTrack('video', 'v2')
    const ops = planTrackOps(fakeStream([a1, v1]), fakeStream([a2, v2]))
    expect(ops.every(o => o.op === 'replace')).toBe(true)
    expect(isReplaceOnlyUpgrade(ops)).toBe(true)
  })

  it('removes video when disabling camera while keeping audio', () => {
    const a1 = fakeTrack('audio', 'a1')
    const v1 = fakeTrack('video', 'v1')
    const a2 = fakeTrack('audio', 'a2')
    const ops = planTrackOps(fakeStream([a1, v1]), fakeStream([a2]))
    expect(ops).toContainEqual({
      op: 'replace',
      kind: 'audio',
      oldTrack: a1,
      newTrack: a2,
    })
    expect(ops).toContainEqual({ op: 'remove', kind: 'video', track: v1 })
  })
})
