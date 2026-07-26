import { describe, expect, it } from 'vitest'
import {
  CLOSE, CommandRegistry, coreCommands, createIdSource, defineCommand, encodeAck,
  encodeError, FrameError, LIMITS, normalizeExclusions, normalizeInterests, parseEnvelope,
} from './index.js'
import { asDeviceKeyId, asMemberId, asOpaqueUserId } from './ids.js'

const frame = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, id: 'cmd-1', type: 'hello', sentAt: Date.now(), ...overrides })

describe('envelope parsing', () => {
  it('accepts a well-formed envelope and drops unknown top-level fields', () => {
    const parsed = parseEnvelope(frame({ nonsense: 'ignored' }), LIMITS.controlFrameBytes)
    expect(parsed.type).toBe('hello')
    expect('nonsense' in parsed).toBe(false)
  })

  it('closes 4002 on a version mismatch, not 4003', () => {
    // The client's terminal "upgrade required" state is reachable only via
    // 4002; reporting a version mismatch as a generic malformed frame left
    // that path dead.
    try {
      parseEnvelope(frame({ v: 2 }), LIMITS.controlFrameBytes)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as FrameError).close).toBe(CLOSE.VERSION_UNSUPPORTED)
      expect((error as FrameError).code).toBe('version-unsupported')
    }
  })

  it.each([
    ['binary', new Uint8Array([1, 2, 3]), CLOSE.MALFORMED_FRAME],
    ['non-json', 'not json at all', CLOSE.MALFORMED_FRAME],
    ['array envelope', '[]', CLOSE.MALFORMED_FRAME],
  ])('closes on %s', (_label, message, expected) => {
    try {
      parseEnvelope(message, LIMITS.controlFrameBytes)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as FrameError).close).toBe(expected)
    }
  })

  it('rejects an oversized frame by bytes, not just by length', () => {
    // Multi-byte characters make UTF-16 length an under-estimate; a frame can
    // pass the cheap check and still exceed the byte cap.
    const padding = '✓'.repeat(LIMITS.controlFrameBytes)
    try {
      parseEnvelope(frame({ payload: { padding } }), LIMITS.controlFrameBytes)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as FrameError).close).toBe(CLOSE.FRAME_TOO_LARGE)
    }
  })

  it('rejects a frame id outside the id pattern', () => {
    expect(() => parseEnvelope(frame({ id: 'has spaces' }), LIMITS.controlFrameBytes)).toThrow(FrameError)
  })
})

describe('command registry', () => {
  it('rejects an unknown command with not-found rather than a parse failure', () => {
    try {
      coreCommands().validate('seek.start', { seekId: 'x', interests: ['music'] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as FrameError).code).toBe('not-found')
    }
  })

  it('carries no app-specific command: core is matchmaking- and directory-free', () => {
    const types = coreCommands().types
    expect(types).not.toContain('seek.start')
    expect(types).not.toContain('directory.publish')
    expect(types).toContain('scope.request')
  })

  it('extends without mutating the registry it came from', () => {
    const core = coreCommands()
    const appCommand = defineCommand<{ ok: true }>('app.thing', () => ({ ok: true }))
    const extended = core.extend([appCommand as never])
    expect(extended.has('app.thing')).toBe(true)
    expect(core.has('app.thing')).toBe(false)
  })

  it('refuses to shadow an existing command', () => {
    const clash = defineCommand<unknown>('hello', payload => payload)
    expect(() => coreCommands().extend([clash as never])).toThrow(/duplicate/)
  })

  it('returns a typed payload so handlers do not re-validate', () => {
    const result = coreCommands().validate('scope.request', { kind: 'room', capability: 'abc' })
    expect(result).toEqual({ kind: 'room', capability: 'abc' })
  })

  it('rejects a scope kind outside the closed set', () => {
    expect(() => coreCommands().validate('scope.request', { kind: 'evil', capability: 'abc' }))
      .toThrow(FrameError)
  })
})

describe('frame ids', () => {
  it('does not collide between two clients started in the same millisecond', () => {
    // The previous format was `${Date.now().toString(36)}-${counter}` with the
    // counter reset per page load, so two devices of one account produced
    // identical ids — and the second silently received the first's cached ack
    // from the gateway's idempotency table.
    const a = createIdSource()
    const b = createIdSource()
    const first = new Set(Array.from({ length: 500 }, () => a.next()))
    const second = new Set(Array.from({ length: 500 }, () => b.next()))
    expect(first.size).toBe(500)
    expect([...second].some(id => first.has(id))).toBe(false)
  })
})

describe('identifier parsers', () => {
  it('parses a well-formed device key id and rejects a malformed one', () => {
    const valid = `P-256:${'a'.repeat(43)}:${'b'.repeat(43)}`
    expect(asDeviceKeyId(valid)).toBe(valid)
    expect(asDeviceKeyId('P-256:short:short')).toBeNull()
    expect(asDeviceKeyId(42)).toBeNull()
  })

  it('rejects an opaque user id that is too short to be an HMAC digest', () => {
    expect(asOpaqueUserId('abc')).toBeNull()
    expect(asOpaqueUserId('a'.repeat(43))).toBe('a'.repeat(43))
  })

  it('accepts any bounded app-space member id', () => {
    expect(asMemberId('member-1')).toBe('member-1')
    expect(asMemberId('')).toBeNull()
  })
})

describe('seek value objects', () => {
  it('has no representation for an empty interest set', () => {
    // A seek with no interests used to be written to storage, enqueued into
    // nothing, and left the user seeking forever in no queue.
    expect(normalizeInterests([])).toBeNull()
    expect(normalizeInterests(['   ', ''])).toBeNull()
    expect(normalizeInterests([42, null])).toBeNull()
  })

  it('normalizes, de-duplicates and caps interests', () => {
    expect(normalizeInterests(['Music', 'music', ' MUSIC '])).toEqual(['music'])
    const many = Array.from({ length: 20 }, (_, index) => `tag${index}`)
    expect(normalizeInterests(many)).toHaveLength(LIMITS.interestsPerSeek)
  })

  it('drops an interest that NFKC expands past the cap', () => {
    // Normalization can lengthen a string, so the cap has to be re-checked
    // after normalizing rather than trusted from an upstream check.
    const ligature = 'ﬁ'.repeat(LIMITS.interestMaxChars)
    expect(ligature.length).toBeLessThanOrEqual(LIMITS.interestMaxChars)
    expect(ligature.normalize('NFKC').length).toBeGreaterThan(LIMITS.interestMaxChars)
    expect(normalizeInterests([ligature])).toBeNull()
  })

  it('caps exclusions and drops entries that are not member ids', () => {
    expect(normalizeExclusions(['a', '', 42, 'b'])).toEqual(['a', 'b'])
    expect(normalizeExclusions('not an array')).toEqual([])
    expect(normalizeExclusions(Array.from({ length: 200 }, (_, i) => `m${i}`)))
      .toHaveLength(LIMITS.exclusionsPerSeek)
  })
})

describe('response frames', () => {
  it('echoes the command id on an ack so a client can settle its promise', () => {
    const payload = JSON.parse(encodeAck('cmd-7', { routeId: 'r1' }))
    expect(payload.payload.for).toBe('cmd-7')
    expect(payload.payload.result).toEqual({ routeId: 'r1' })
  })

  it('marks a retryable error with its retry hint', () => {
    const payload = JSON.parse(encodeError('rate-limited', { forId: 'c1', retryable: true, retryAfterMs: 1000 }))
    expect(payload.payload).toMatchObject({ for: 'c1', code: 'rate-limited', retryable: true, retryAfterMs: 1000 })
  })
})

describe('registry construction', () => {
  it('builds an app registry from core plus app commands', () => {
    const seekStart = defineCommand<{ seekId: string }>('seek.start', payload => {
      const value = payload as { seekId?: unknown }
      if (typeof value.seekId !== 'string') throw new FrameError('bad seek')
      return { seekId: value.seekId }
    })
    const app = coreCommands().extend([seekStart as never])
    expect(app.validate('seek.start', { seekId: 's1' })).toEqual({ seekId: 's1' })
    expect(CommandRegistry.of([seekStart as never]).has('hello')).toBe(false)
  })
})
