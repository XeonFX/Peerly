import { LIMITS } from './limits.mjs'

/** Client → server command types the gateway DO accepts. */
export const COMMAND_TYPES = new Set([
  'hello', 'scope.request', 'scope.leave', 'seek.start', 'seek.cancel',
  'invite.send', 'invite.ack', 'ring.send',
  'directory.publish', 'directory.delete', 'directory.list', 'resume',
])

/**
 * The one frame type accepted on a signal socket. Its payload is forwarded
 * opaquely (SDP/ICE) — SignalScopeDO never inspects it beyond the bounded
 * envelope and an optional `to` routing field, so it is validated separately
 * from COMMAND_TYPES rather than folded into that closed union.
 */
export const SIGNAL_TYPE = 'signal'

/** Server → client delta event kinds (payload of a `delta` frame). */
export const EVENT_KINDS = new Set([
  'invite', 'invite.acked', 'ring', 'seek.state', 'match.commit',
  'directory.change', 'workspace.presence', 'device.revoked', 'sync.notice',
])

export const ERROR_CODES = new Set([
  'invalid-frame', 'auth-required', 'version-unsupported',
  'rate-limited', 'too-large', 'cap-exceeded',
  'not-found', 'conflict', 'service-unavailable', 'internal',
])

/** WebSocket close codes used across the control and signal sockets. */
export const CLOSE = Object.freeze({
  AUTH_REQUIRED: 4001,
  VERSION_UNSUPPORTED: 4002,
  MALFORMED_FRAME: 4003,
  RATE_LIMIT_ABUSE: 4008,
  SLOW_CONSUMER: 4009,
  FRAME_TOO_LARGE: 4013,
})

const ID_PATTERN = /^[\w-]{1,64}$/

class FrameError extends Error {
  constructor(message, { close } = {}) {
    super(message)
    this.close = close ?? null
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function boundedArray(value, maxLength, item) {
  return Array.isArray(value) && value.length <= maxLength && value.every(item)
}

/**
 * Parse and validate one incoming WebSocket text message against the closed
 * envelope + per-type payload shape. Throws FrameError; callers distinguish
 * a fatal shape (`error.close` set → close the socket) from a soft rejection
 * (`error.close` null → send an `error` frame and keep the socket open).
 *
 * Byte-size check happens twice deliberately: `message.length` is a cheap
 * lower bound on UTF-16 code units that rejects the overwhelming majority of
 * oversized frames before we pay for a TextEncoder pass.
 */
export function parseFrame(message, { maxBytes, allowedTypes = COMMAND_TYPES }) {
  if (typeof message !== 'string') throw new FrameError('binary frames are not accepted', { close: CLOSE.MALFORMED_FRAME })
  if (message.length > maxBytes) throw new FrameError('frame too large', { close: CLOSE.FRAME_TOO_LARGE })
  const bytes = new TextEncoder().encode(message)
  if (bytes.byteLength > maxBytes) throw new FrameError('frame too large', { close: CLOSE.FRAME_TOO_LARGE })

  let envelope
  try {
    envelope = JSON.parse(message)
  } catch {
    throw new FrameError('malformed json', { close: CLOSE.MALFORMED_FRAME })
  }
  if (!isPlainObject(envelope)) throw new FrameError('malformed envelope', { close: CLOSE.MALFORMED_FRAME })
  const { v, id, type, scope, sentAt, payload } = envelope
  if (v !== 1) throw new FrameError('unsupported version', { close: CLOSE.MALFORMED_FRAME })
  if (!boundedString(id, 64) || !ID_PATTERN.test(id)) throw new FrameError('malformed id', { close: CLOSE.MALFORMED_FRAME })
  if (!allowedTypes.has(type)) throw new FrameError('unknown type', { close: CLOSE.MALFORMED_FRAME })
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) throw new FrameError('malformed sentAt', { close: CLOSE.MALFORMED_FRAME })
  if (scope !== undefined && !boundedString(scope, 128)) throw new FrameError('malformed scope', { close: CLOSE.MALFORMED_FRAME })

  validatePayload(type, payload)
  return { v: 1, id, type, scope, sentAt, payload }
}

function validatePayload(type, payload) {
  const fail = () => { throw new FrameError(`malformed payload for ${type}`) }
  switch (type) {
    case SIGNAL_TYPE:
      // Opaque SDP/ICE content: only the envelope and an optional routing
      // field are ever inspected, never the payload's inner shape.
      if (!isPlainObject(payload)) fail()
      if (payload.to !== undefined && !boundedString(payload.to, 128)) fail()
      return
    case 'hello':
      if (!isPlainObject(payload) || payload.version !== 1) fail()
      if (payload.resumeSeq !== undefined && typeof payload.resumeSeq !== 'number') fail()
      return
    case 'scope.request':
      if (!isPlainObject(payload)) fail()
      if (!['workspace', 'dm', 'room', 'chat'].includes(payload.kind)) fail()
      if (!boundedString(payload.capability, 256)) fail()
      return
    case 'scope.leave':
      if (!isPlainObject(payload) || !boundedString(payload.routeId, 128)) fail()
      return
    case 'seek.start':
      if (!isPlainObject(payload)) fail()
      if (!boundedString(payload.seekId, 64)) fail()
      if (!boundedArray(payload.interests, LIMITS.interestsPerSeek, value => boundedString(value, 32))) fail()
      if (payload.exclusions !== undefined && !boundedArray(payload.exclusions, 50, value => boundedString(value, 128))) fail()
      return
    case 'seek.cancel':
      if (!isPlainObject(payload) || !boundedString(payload.seekId, 64)) fail()
      return
    case 'invite.send':
      if (!isPlainObject(payload)) fail()
      if (!boundedString(payload.to, 128) || !boundedString(payload.kind, 40)) fail()
      if (!isPlainObject(payload.body) || new TextEncoder().encode(JSON.stringify(payload.body)).byteLength > 4096) fail()
      return
    case 'invite.ack':
      if (!isPlainObject(payload) || !boundedString(payload.inviteId, 64)) fail()
      return
    case 'ring.send':
      if (!isPlainObject(payload)) fail()
      if (!boundedString(payload.to, 128) || !boundedString(payload.roomRoute, 128)) fail()
      return
    case 'directory.publish':
      if (!isPlainObject(payload)) fail()
      if (!boundedString(payload.roomId, 128) || typeof payload.revision !== 'number') fail()
      if (!isPlainObject(payload.entry) ||
          new TextEncoder().encode(JSON.stringify(payload.entry)).byteLength > LIMITS.directoryPayloadBytes) fail()
      return
    case 'directory.delete':
      if (!isPlainObject(payload)) fail()
      if (!boundedString(payload.roomId, 128) || typeof payload.revision !== 'number') fail()
      return
    case 'directory.list':
      if (payload !== undefined && !isPlainObject(payload)) fail()
      if (isPlainObject(payload) && payload.cursor !== undefined && !boundedString(payload.cursor, 256)) fail()
      return
    case 'resume':
      if (!isPlainObject(payload) || typeof payload.fromSeq !== 'number') fail()
      return
    default:
      fail()
  }
}

export function encodeFrame(type, { id, scope, seq, payload } = {}) {
  const frame = { v: 1, id: id ?? crypto.randomUUID(), type, sentAt: Date.now() }
  if (scope !== undefined) frame.scope = scope
  if (seq !== undefined) frame.seq = seq
  if (payload !== undefined) frame.payload = payload
  return JSON.stringify(frame)
}

export function encodeAck(forId, result) {
  return encodeFrame('ack', { payload: { for: forId, ...(result !== undefined ? { result } : {}) } })
}

export function encodeError(code, { forId, retryable = false, retryAfterMs } = {}) {
  return encodeFrame('error', {
    payload: {
      ...(forId ? { for: forId } : {}),
      code,
      retryable,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    },
  })
}

export function encodeSnapshot(kind, state, seq) {
  return encodeFrame('snapshot', { payload: { kind, state, seq } })
}

export function encodeDelta(events, seq) {
  return encodeFrame('delta', { payload: { events, seq } })
}

export { FrameError }
