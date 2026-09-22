import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayService, type CommandHandler } from './gatewayService.js'
import { createMemoryGatewayStorage } from '../adapters/memory/gatewayStorage.js'
import { coreCommands, defineCommand, FrameError, LIMITS, CLOSE } from '../protocol/index.js'
import type { GatewayStorage, ControlSocket } from '../ports/index.js'
import type { DeviceKeyId, OpaqueUserId } from '../protocol/ids.js'

/**
 * The whole command loop, with no Durable Object anywhere. This is the suite
 * the previous implementation could not have: its logic lived inside a DO, so
 * its tests reached past the loop to the RPCs, and the loop itself — version
 * negotiation, idempotency, error reporting — went untested.
 */

function fakeSocket(overrides: Partial<ControlSocket> = {}) {
  const sent: string[] = []
  const closed: Array<{ code: number; reason: string }> = []
  let negotiated = false
  const socket: ControlSocket = {
    id: 'socket-1',
    deviceKeyId: 'device-a' as DeviceKeyId,
    negotiated: () => negotiated,
    markNegotiated: () => { negotiated = true },
    send: frame => { sent.push(frame) },
    close: (code, reason) => { closed.push({ code, reason }) },
    ...overrides,
  }
  return {
    socket,
    sent,
    closed,
    frames: () => sent.map(frame => JSON.parse(frame)),
    last: () => JSON.parse(sent[sent.length - 1]),
  }
}

const command = (type: string, payload?: unknown, id = `cmd-${Math.random().toString(36).slice(2, 8)}`) =>
  JSON.stringify({ v: 1, id, type, sentAt: Date.now(), ...(payload !== undefined ? { payload } : {}) })

describe('GatewayService', () => {
  let storage: GatewayStorage
  let clock: { nowMs: () => number }
  let handlers: Record<string, CommandHandler>

  const build = (snapshot: () => unknown = () => ({ seek: null })) => new GatewayService({
    storage,
    clock,
    registry: coreCommands().extend([
      defineCommand<{ value: string }>('app.echo', payload => {
        const record = payload as { value?: unknown }
        if (typeof record.value !== 'string') throw new FrameError('bad echo')
        return { value: record.value }
      }) as never,
    ]),
    handlers,
    snapshot,
  })

  beforeEach(() => {
    storage = createMemoryGatewayStorage()
    storage.identity.remember('account-1' as OpaqueUserId)
    clock = { nowMs: () => 1_000 }
    handlers = {
      'app.echo': (payload: never) => ({ echoed: (payload as { value: string }).value }),
    }
  })

  const hello = async (service: GatewayService, harness: ReturnType<typeof fakeSocket>, resumeSeq?: number) => {
    await service.handleMessage(harness.socket, command('hello', {
      version: 1, ...(resumeSeq !== undefined ? { resumeSeq } : {}),
    }, 'hello-1'))
  }

  describe('version negotiation', () => {
    it('acks a matching hello and marks the socket negotiated', async () => {
      const harness = fakeSocket()
      await hello(build(), harness)
      expect(harness.last().type).toBe('ack')
      expect(harness.socket.negotiated()).toBe(true)
    })

    it('closes 4002 on an unsupported version, after a bye', async () => {
      // 4002 is the only path to the client's terminal upgrade state; without
      // it a client retries forever against a server it cannot talk to.
      const harness = fakeSocket()
      await build().handleMessage(harness.socket, command('hello', { version: 99 }, 'hello-1'))
      expect(harness.frames().map(frame => frame.type)).toContain('bye')
      expect(harness.closed[0].code).toBe(CLOSE.VERSION_UNSUPPORTED)
    })

    it('refuses any command sent before hello', async () => {
      const harness = fakeSocket()
      await build().handleMessage(harness.socket, command('app.echo', { value: 'x' }))
      expect(harness.closed[0].code).toBe(CLOSE.MALFORMED_FRAME)
    })

    it('closes 4002 for an envelope version mismatch too', async () => {
      const harness = fakeSocket()
      await build().handleMessage(
        harness.socket,
        JSON.stringify({ v: 7, id: 'c1', type: 'hello', sentAt: Date.now(), payload: { version: 1 } })
      )
      expect(harness.closed[0].code).toBe(CLOSE.VERSION_UNSUPPORTED)
    })
  })

  describe('dispatch', () => {
    it('routes a validated payload to its handler and acks the result', async () => {
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(harness.socket, command('app.echo', { value: 'hi' }, 'cmd-1'))
      expect(harness.last().payload).toEqual({ for: 'cmd-1', result: { echoed: 'hi' } })
    })

    it('reports an unknown command as not-found without closing', async () => {
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(harness.socket, command('nope.nope', {}, 'cmd-1'))
      expect(harness.last().payload.code).toBe('not-found')
      expect(harness.closed).toHaveLength(0)
    })

    it('reports a bad payload as invalid-frame without closing the socket', async () => {
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(harness.socket, command('app.echo', { value: 42 }, 'cmd-1'))
      expect(harness.last().payload.code).toBe('invalid-frame')
      expect(harness.closed).toHaveLength(0)
    })

    it('answers internal when a handler throws an unexpected error', async () => {
      // A throw used to produce no ack, no error and no idempotency row, so
      // the client waited out its full command timeout for nothing.
      handlers['app.echo'] = () => { throw new Error('boom') }
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }, 'cmd-1'))
      expect(harness.last().payload).toMatchObject({ for: 'cmd-1', code: 'internal', retryable: true })
    })

    it('reports a handler FrameError with its own code', async () => {
      handlers['app.echo'] = () => { throw new FrameError('nope', { code: 'conflict' }) }
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }, 'cmd-1'))
      expect(harness.last().payload.code).toBe('conflict')
    })

    it('does not remember an ack for a command that failed', async () => {
      handlers['app.echo'] = () => { throw new Error('boom') }
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }, 'cmd-1'))
      expect(storage.idempotency.recall('cmd-1')).toBeUndefined()
    })

    it('requires an identity before dispatching', async () => {
      storage = createMemoryGatewayStorage()
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }, 'cmd-1'))
      expect(harness.last().payload.code).toBe('auth-required')
    })
  })

  describe('idempotency', () => {
    it('replays the original ack instead of running the handler twice', async () => {
      const handler = vi.fn(() => ({ ok: true }))
      handlers['app.echo'] = handler as CommandHandler
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }, 'same-id'))
      await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }, 'same-id'))
      expect(handler).toHaveBeenCalledTimes(1)
      expect(harness.frames().filter(frame => frame.payload?.for === 'same-id')).toHaveLength(2)
    })
  })

  describe('rate limiting', () => {
    it('rejects past the burst with a retry hint, and recovers as tokens refill', async () => {
      const harness = fakeSocket()
      let now = 1_000
      clock = { nowMs: () => now }
      const service = build()
      await hello(service, harness)
      for (let i = 0; i < LIMITS.commandsBurst; i += 1) {
        await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }))
      }
      await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }))
      const limited = harness.last()
      expect(limited.payload.code).toBe('rate-limited')
      expect(limited.payload.retryAfterMs).toBeGreaterThan(0)

      now += 1_000
      await service.handleMessage(harness.socket, command('app.echo', { value: 'x' }))
      expect(harness.last().type).toBe('ack')
    })

    it('limits each socket independently', async () => {
      const first = fakeSocket()
      const second = fakeSocket({ id: 'socket-2' })
      const service = build()
      await hello(service, first)
      await hello(service, second)
      for (let i = 0; i < LIMITS.commandsBurst; i += 1) {
        await service.handleMessage(first.socket, command('app.echo', { value: 'x' }))
      }
      await service.handleMessage(second.socket, command('app.echo', { value: 'x' }, 'other-1'))
      expect(second.last().type).toBe('ack')
    })
  })

  describe('resume', () => {
    it('sends only events after the cursor', async () => {
      storage.events.append([{ kind: 'ring', body: { n: 1 } }, { kind: 'ring', body: { n: 2 } }], 0)
      const harness = fakeSocket()
      await hello(build(), harness, 1)
      const delta = harness.last()
      expect(delta.type).toBe('delta')
      expect(delta.payload.events).toHaveLength(1)
      expect(delta.payload.seq).toBe(2)
    })

    it('sends a snapshot when the cursor has aged out', async () => {
      // Unreachable before: the cursor lived in memory, every load resumed
      // from 0, and 0 never compared as aged out — so the gateway replayed its
      // entire retention window instead of re-seeding.
      storage.events.append(Array.from({ length: 5 }, () => ({ kind: 'ring', body: {} })), 0)
      storage.events.prune(1_000, 2)
      const harness = fakeSocket()
      await hello(build(() => ({ seek: 'state' })), harness, 0)
      const snapshot = harness.last()
      expect(snapshot.type).toBe('snapshot')
      expect(snapshot.payload.state).toEqual({ seek: 'state' })
    })

    it('sends nothing when the client is already current', async () => {
      storage.events.append([{ kind: 'ring', body: {} }], 0)
      const harness = fakeSocket()
      await hello(build(), harness, 1)
      expect(harness.frames().filter(frame => frame.type === 'delta')).toHaveLength(0)
    })

    it('answers a mid-session resume command', async () => {
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      storage.events.append([{ kind: 'invite', body: {} }], 0)
      await service.handleMessage(harness.socket, command('resume', { fromSeq: 0 }, 'cmd-r'))
      expect(harness.last().type).toBe('delta')
    })
  })

  describe('frame hygiene', () => {
    it('closes on an oversized frame', async () => {
      const harness = fakeSocket()
      const service = build()
      await hello(service, harness)
      await service.handleMessage(
        harness.socket,
        command('app.echo', { value: 'x'.repeat(LIMITS.controlFrameBytes) })
      )
      expect(harness.closed[0].code).toBe(CLOSE.FRAME_TOO_LARGE)
    })

    it('closes on a non-string frame', async () => {
      const harness = fakeSocket()
      await build().handleMessage(harness.socket, new Uint8Array([1, 2]))
      expect(harness.closed[0].code).toBe(CLOSE.MALFORMED_FRAME)
    })
  })
})
