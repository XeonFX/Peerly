/**
 * The wire envelope: encoding, decoding, and the size/shape checks that run
 * before any payload is looked at.
 *
 * Pure. No platform globals beyond `TextEncoder`, so every rule here is unit
 * testable without a Durable Object, a socket, or a browser.
 */
import { LIMITS } from './limits.js'
import { isValidFrameId } from './ids.js'

export const CLOSE = {
  AUTH_REQUIRED: 4001,
  VERSION_UNSUPPORTED: 4002,
  MALFORMED_FRAME: 4003,
  RATE_LIMIT_ABUSE: 4008,
  SLOW_CONSUMER: 4009,
  FRAME_TOO_LARGE: 4013,
} as const

export type CloseCode = (typeof CLOSE)[keyof typeof CLOSE]

export const ERROR_CODES = [
  'invalid-frame', 'auth-required', 'version-unsupported',
  'rate-limited', 'too-large', 'cap-exceeded',
  'not-found', 'conflict', 'service-unavailable', 'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type Envelope = {
  v: 1
  id: string
  type: string
  scope?: string
  seq?: number
  sentAt: number
  payload?: unknown
}

/**
 * A rejected frame. `close` distinguishes a fatal shape (drop the socket)
 * from a soft rejection (answer with an error frame and keep serving) — the
 * caller must not have to infer that from the message.
 */
export class FrameError extends Error {
  readonly close: CloseCode | null
  readonly code: ErrorCode

  constructor(message: string, options: { close?: CloseCode; code?: ErrorCode } = {}) {
    super(message)
    this.name = 'FrameError'
    this.close = options.close ?? null
    this.code = options.code ?? 'invalid-frame'
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

export function boundedArray<T>(
  value: unknown,
  maxLength: number,
  item: (entry: unknown) => entry is T
): value is T[] {
  return Array.isArray(value) && value.length <= maxLength && value.every(item)
}

/** Encoded byte length, used wherever a cap is specified in bytes. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Validate the envelope only. Payload shape belongs to the command registry,
 * so this stays app-agnostic and every app pays the same size and version
 * checks in the same order.
 *
 * The size check runs twice on purpose: `length` is a cheap lower bound on
 * bytes that rejects the overwhelming majority of oversized frames before
 * paying for a `TextEncoder` pass.
 */
export function parseEnvelope(message: unknown, maxBytes: number): Envelope {
  if (typeof message !== 'string') {
    throw new FrameError('binary frames are not accepted', { close: CLOSE.MALFORMED_FRAME })
  }
  if (message.length > maxBytes || byteLength(message) > maxBytes) {
    throw new FrameError('frame too large', { close: CLOSE.FRAME_TOO_LARGE, code: 'too-large' })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(message)
  } catch {
    throw new FrameError('malformed json', { close: CLOSE.MALFORMED_FRAME })
  }
  if (!isPlainObject(parsed)) {
    throw new FrameError('malformed envelope', { close: CLOSE.MALFORMED_FRAME })
  }

  // Version first: an unsupported version must reach the client's terminal
  // upgrade path, not be reported as a generic malformed frame.
  if (parsed.v !== LIMITS.protocolVersion) {
    throw new FrameError('unsupported version', {
      close: CLOSE.VERSION_UNSUPPORTED,
      code: 'version-unsupported',
    })
  }
  if (!isValidFrameId(parsed.id)) {
    throw new FrameError('malformed id', { close: CLOSE.MALFORMED_FRAME })
  }
  if (typeof parsed.type !== 'string' || !parsed.type) {
    throw new FrameError('malformed type', { close: CLOSE.MALFORMED_FRAME })
  }
  if (typeof parsed.sentAt !== 'number' || !Number.isFinite(parsed.sentAt)) {
    throw new FrameError('malformed sentAt', { close: CLOSE.MALFORMED_FRAME })
  }
  if (parsed.scope !== undefined && !boundedString(parsed.scope, 128)) {
    throw new FrameError('malformed scope', { close: CLOSE.MALFORMED_FRAME })
  }

  return {
    v: 1,
    id: parsed.id,
    type: parsed.type,
    sentAt: parsed.sentAt,
    ...(parsed.scope !== undefined ? { scope: parsed.scope as string } : {}),
    ...(parsed.payload !== undefined ? { payload: parsed.payload } : {}),
  }
}

type EncodeOptions = {
  id?: string
  scope?: string
  seq?: number
  payload?: unknown
}

export function encodeFrame(type: string, options: EncodeOptions & { id: string }): string {
  const frame: Envelope = { v: 1, id: options.id, type, sentAt: Date.now() }
  if (options.scope !== undefined) frame.scope = options.scope
  if (options.seq !== undefined) frame.seq = options.seq
  if (options.payload !== undefined) frame.payload = options.payload
  return JSON.stringify(frame)
}

export function encodeAck(forId: string, result?: unknown): string {
  return encodeFrame('ack', {
    id: forId,
    payload: { for: forId, ...(result !== undefined ? { result } : {}) },
  })
}

export function encodeError(
  code: ErrorCode,
  options: { forId?: string; retryable?: boolean; retryAfterMs?: number } = {}
): string {
  return encodeFrame('error', {
    id: options.forId ?? 'error',
    payload: {
      ...(options.forId ? { for: options.forId } : {}),
      code,
      retryable: options.retryable ?? false,
      ...(options.retryAfterMs !== undefined ? { retryAfterMs: options.retryAfterMs } : {}),
    },
  })
}

export function encodeSnapshot(id: string, kind: string, state: unknown, seq: number): string {
  return encodeFrame('snapshot', { id, payload: { kind, state, seq } })
}

export function encodeDelta(id: string, events: readonly unknown[], seq: number): string {
  return encodeFrame('delta', { id, payload: { events, seq } })
}

/** Sent immediately before a server-initiated close, so the client can tell a
 *  deliberate shutdown from a dropped connection. */
export function encodeBye(id: string, code: CloseCode): string {
  return encodeFrame('bye', { id, payload: { code } })
}

export function decodeFrame(raw: string): Envelope | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainObject(parsed)) return null
    if (parsed.v !== 1 || typeof parsed.type !== 'string') return null
    return parsed as Envelope
  } catch {
    return null
  }
}
