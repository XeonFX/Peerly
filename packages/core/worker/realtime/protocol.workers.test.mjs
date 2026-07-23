import { describe, expect, it } from 'vitest'
import { CLOSE, encodeFrame, FrameError, parseFrame, SIGNAL_TYPE } from './protocol.mjs'

function hello(overrides = {}) {
  return JSON.stringify({ v: 1, id: 'cmd-1', type: 'hello', sentAt: Date.now(), payload: { version: 1 }, ...overrides })
}

describe('parseFrame', () => {
  it('accepts a well-formed hello frame', () => {
    const frame = parseFrame(hello(), { maxBytes: 32 * 1024 })
    expect(frame.type).toBe('hello')
    expect(frame.payload).toEqual({ version: 1 })
  })

  it('rejects a frame at exactly one byte over the limit with FRAME_TOO_LARGE', () => {
    const oversized = 'x'.repeat(33)
    let error
    try {
      parseFrame(oversized, { maxBytes: 32 })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(FrameError)
    expect(error.close).toBe(CLOSE.FRAME_TOO_LARGE)
  })

  it('accepts a frame at exactly the byte limit', () => {
    // 32 bytes exactly is not valid JSON, but the size check itself must not throw first.
    const body = { v: 1, id: 'a', type: 'hello', sentAt: 1, payload: { version: 1 } }
    const text = JSON.stringify(body)
    const frame = parseFrame(text, { maxBytes: new TextEncoder().encode(text).byteLength })
    expect(frame.id).toBe('a')
  })

  it('rejects malformed JSON with MALFORMED_FRAME', () => {
    let error
    try {
      parseFrame('{not json', { maxBytes: 1024 })
    } catch (caught) {
      error = caught
    }
    expect(error.close).toBe(CLOSE.MALFORMED_FRAME)
  })

  it('rejects an unknown frame type', () => {
    expect(() => parseFrame(hello({ type: 'not-a-real-type' }), { maxBytes: 1024 })).toThrow(FrameError)
  })

  it('discards unknown top-level fields instead of rejecting', () => {
    const frame = parseFrame(hello({ extraneous: 'ignored' }), { maxBytes: 1024 })
    expect(frame.extraneous).toBeUndefined()
  })

  it('rejects a malformed id', () => {
    expect(() => parseFrame(hello({ id: 'has a space' }), { maxBytes: 1024 })).toThrow(FrameError)
  })

  it('soft-rejects a malformed payload without closing the socket', () => {
    let error
    try {
      parseFrame(hello({ payload: { version: 2 } }), { maxBytes: 1024 })
    } catch (caught) {
      error = caught
    }
    expect(error.close).toBeNull()
  })

  it('enforces the interests-per-seek cap', () => {
    const tooMany = JSON.stringify({
      v: 1, id: 'seek-1', type: 'seek.start', sentAt: Date.now(),
      payload: { seekId: 's1', interests: ['a', 'b', 'c', 'd', 'e', 'f'] },
    })
    expect(() => parseFrame(tooMany, { maxBytes: 1024 })).toThrow(FrameError)
  })

  it('only accepts the signal type when scoped to SIGNAL_TYPES', () => {
    const signalFrame = JSON.stringify({ v: 1, id: 's1', type: SIGNAL_TYPE, sentAt: Date.now(), payload: { sdp: 'opaque' } })
    const parsed = parseFrame(signalFrame, { maxBytes: 1024, allowedTypes: new Set([SIGNAL_TYPE]) })
    expect(parsed.payload).toEqual({ sdp: 'opaque' })
    expect(() => parseFrame(hello(), { maxBytes: 1024, allowedTypes: new Set([SIGNAL_TYPE]) })).toThrow(FrameError)
  })
})

describe('encodeFrame', () => {
  it('round-trips through parseFrame for a directory.list command', () => {
    const text = encodeFrame('directory.list', { id: 'list-1', payload: { cursor: 'abc' } })
    const frame = parseFrame(text, { maxBytes: 1024 })
    expect(frame).toMatchObject({ id: 'list-1', type: 'directory.list', payload: { cursor: 'abc' } })
  })
})
