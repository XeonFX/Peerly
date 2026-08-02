import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayRuntime, type RawSocket } from './gatewayRuntime.js'
import { createMemoryGatewayStorage } from '../memory/gatewayStorage.js'
import { createCoreHandlers } from '../../app/coreHandlers.js'
import { coreCommands, LIMITS, CLOSE } from '../../protocol/index.js'
import type { GatewayStorage } from '../../ports/index.js'
import type { DeviceKeyId, OpaqueUserId } from '../../protocol/ids.js'

/**
 * The Durable Object runtime, driven entirely by plain objects. Nothing here
 * imports `cloudflare:workers`, which is the point of keeping the class in the
 * app's worker and the behaviour in core: everything below used to require a
 * real DO to exercise, so none of it was exercised.
 */

const DEVICE_A = `P-256:${'a'.repeat(43)}:${'b'.repeat(43)}`
const DEVICE_B = `P-256:${'c'.repeat(43)}:${'d'.repeat(43)}`
const ACCOUNT = 'a'.repeat(43)

function fakeSocket(): RawSocket & { sent: string[]; closed: Array<{ code: number }> } {
  let attachment: unknown = {}
  const sent: string[] = []
  const closed: Array<{ code: number }> = []
  return {
    sent,
    closed,
    send: data => { sent.push(data) },
    close: code => { closed.push({ code }) },
    serializeAttachment: value => { attachment = value },
    deserializeAttachment: () => attachment,
  }
}

describe('GatewayRuntime', () => {
  let storage: GatewayStorage
  let sockets: ReturnType<typeof fakeSocket>[]
  let alarms: number[]
  let nowMs: number
  let uuidCounter: number
  /** The batching window, driven by hand rather than waited out. */
  let pendingFlushes: (() => void)[]

  const runFlushes = async () => {
    const due = pendingFlushes
    pendingFlushes = []
    for (const resolve of due) resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  const ctx = {
    getWebSockets: () => sockets,
    acceptWebSocket: (socket: RawSocket) => {
      if (!sockets.includes(socket as ReturnType<typeof fakeSocket>)) {
        sockets.push(socket as ReturnType<typeof fakeSocket>)
      }
    },
    storage: {
      setAlarm: async (timestampMs: number) => { alarms.push(timestampMs) },
      getAlarm: async () => alarms[alarms.length - 1] ?? null,
    },
  }

  const build = (presence: { publish: ReturnType<typeof vi.fn> } | null = null) => {
    const runtime: GatewayRuntime = new GatewayRuntime({
      ctx,
      storage,
      clock: { nowMs: () => nowMs },
      random: { uuid: () => `uuid-${++uuidCounter}` },
      registry: coreCommands(),
      handlers: createCoreHandlers({
        storage,
        clock: { nowMs: () => nowMs },
        random: { uuid: () => `uuid-${++uuidCounter}` },
        sockets: { all: () => [], others: () => [] },
        deriveRouteId: async (kind, capability) => `route-${kind}-${capability}`,
        scopes: null,
        peers: null,
        emit: async events => runtime.emit(events),
      }),
      presence,
      scheduler: { after: () => new Promise<void>(resolve => { pendingFlushes.push(resolve) }) },
      urgentKinds: new Set(['device.revoked']),
      snapshot: () => ({}),
    })
    return runtime
  }

  beforeEach(() => {
    storage = createMemoryGatewayStorage()
    sockets = []
    alarms = []
    nowMs = 1_000
    uuidCounter = 0
    pendingFlushes = []
  })

  describe('session registration', () => {
    it('issues a session and remembers the account it was told', () => {
      const runtime = build()
      const result = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000, uid: ACCOUNT,
      })
      expect(result).toMatchObject({ epoch: 0 })
      expect(storage.identity.current()).toBe(ACCOUNT)
    })

    it('rejects a malformed device key rather than storing it', () => {
      expect(build().registerSession({ deviceKeyId: 'nope', nowMs, ttlMs: 60_000 }))
        .toEqual({ error: 'invalid-device' })
    })

    it('evicts the oldest device at the cap and closes its socket', () => {
      const runtime = build()
      const devices = Array.from(
        { length: LIMITS.controlSocketsPerAccount },
        (_, index) => `P-256:${String(index).repeat(43)}:${String(index).repeat(43)}`
      )
      devices.forEach((device, index) => {
        runtime.registerSession({ deviceKeyId: device, nowMs: nowMs + index, ttlMs: 60_000 })
      })
      runtime.registerSession({ deviceKeyId: DEVICE_B, nowMs: nowMs + 100, ttlMs: 60_000 })
      expect(storage.sessions.all().some(session => session.deviceKeyId === devices[0])).toBe(false)
    })
  })

  describe('session validation', () => {
    it('accepts a live session and rejects it after the epoch is bumped', () => {
      const runtime = build()
      const { sid, epoch } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000, uid: ACCOUNT,
      }) as { sid: string; epoch: number }
      expect(runtime.validateSession({ sid, deviceKeyId: DEVICE_A, epoch })).toBe(true)
      storage.sessions.setEpoch(DEVICE_A as DeviceKeyId, epoch + 1)
      expect(runtime.validateSession({ sid, deviceKeyId: DEVICE_A, epoch })).toBe(false)
    })

    it('rejects an expired session', () => {
      const runtime = build()
      const { sid, epoch } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 10,
      }) as { sid: string; epoch: number }
      nowMs += 1_000
      expect(runtime.validateSession({ sid, deviceKeyId: DEVICE_A, epoch })).toBe(false)
    })
  })

  describe('upgrade', () => {
    it('accepts an authenticated upgrade and records the account', async () => {
      const runtime = build()
      const { sid } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000,
      }) as { sid: string }
      const socket = fakeSocket()
      const result = await runtime.accept(socket, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })
      expect(result).toEqual({ ok: true })
      expect(storage.identity.current()).toBe(ACCOUNT)
    })

    it('refuses an upgrade with no matching session', async () => {
      const runtime = build()
      const result = await runtime.accept(fakeSocket(), {
        uid: ACCOUNT, deviceKeyId: DEVICE_A, sid: 'nonexistent',
      })
      expect(result).toEqual({ ok: false, status: 401 })
    })

    it('refuses an upgrade whose identity is not a well-formed opaque id', async () => {
      const runtime = build()
      expect(await runtime.accept(fakeSocket(), { uid: 'x', deviceKeyId: DEVICE_A, sid: 's' }))
        .toEqual({ ok: false, status: 401 })
    })

    it('drops the oldest socket once the per-account cap is reached', async () => {
      const runtime = build()
      const { sid } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000,
      }) as { sid: string }
      const opened: ReturnType<typeof fakeSocket>[] = []
      for (let index = 0; index <= LIMITS.controlSocketsPerAccount; index += 1) {
        const socket = fakeSocket()
        opened.push(socket)
        await runtime.accept(socket, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })
      }
      expect(opened[0].closed[0].code).toBe(CLOSE.SLOW_CONSUMER)
    })
  })

  describe('event emission', () => {
    it('appends and pushes a delta to every connected socket', async () => {
      const runtime = build()
      const { sid } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000,
      }) as { sid: string }
      const socket = fakeSocket()
      await runtime.accept(socket, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })

      await runtime.emit([{ kind: 'ring', body: { from: 'someone' } }])
      // Persisted at once; the send waits out the batching window.
      expect(storage.events.latestSeq()).toBe(1)
      await runFlushes()
      const delta = JSON.parse(socket.sent[socket.sent.length - 1])
      expect(delta.type).toBe('delta')
      expect(delta.payload.events[0].kind).toBe('ring')
    })

    it('coalesces separate emits into one delta frame', async () => {
      const runtime = build()
      const { sid } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000,
      }) as { sid: string }
      const socket = fakeSocket()
      await runtime.accept(socket, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })
      const before = socket.sent.length

      await runtime.emit([{ kind: 'ring', body: { from: 'a' } }])
      await runtime.emit([{ kind: 'ring', body: { from: 'b' } }])
      expect(socket.sent.length).toBe(before)

      await runFlushes()
      expect(socket.sent.length).toBe(before + 1)
      const delta = JSON.parse(socket.sent[socket.sent.length - 1])
      expect(delta.payload.events.map((event: { body: { from: string } }) => event.body.from))
        .toEqual(['a', 'b'])
      expect(delta.payload.seq).toBe(2)
    })

    it('flushes without waiting once the item cap is reached', async () => {
      const runtime = build()
      const { sid } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000,
      }) as { sid: string }
      const socket = fakeSocket()
      await runtime.accept(socket, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })
      const before = socket.sent.length

      await runtime.emit(
        Array.from({ length: LIMITS.batchMaxEvents }, (_, index) => ({
          kind: 'ring', body: { from: String(index) },
        }))
      )
      expect(socket.sent.length).toBe(before + 1)
    })

    /** The architecture forbids delaying a revoke behind a batching window. */
    it('sends an urgent kind immediately, after anything already pending', async () => {
      const runtime = build()
      const { sid } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000,
      }) as { sid: string }
      const socket = fakeSocket()
      await runtime.accept(socket, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })
      const before = socket.sent.length

      await runtime.emit([{ kind: 'ring', body: { from: 'a' } }])
      await runtime.emit([{ kind: 'device.revoked', body: { deviceKeyId: DEVICE_A } }])

      // Two frames, pending batch first: a client applies deltas by sequence,
      // so the urgent one must not overtake what it follows.
      expect(socket.sent.length).toBe(before + 2)
      const [queued, urgent] = socket.sent.slice(-2).map(frame => JSON.parse(frame))
      expect(queued.payload.events[0].kind).toBe('ring')
      expect(urgent.payload.events[0].kind).toBe('device.revoked')
    })

    it('stores a mailbox copy without needing an open socket', async () => {
      await build().emit([], { inviteId: 'i1', body: '{}' }, ACCOUNT)
      expect(storage.mailbox.count()).toBe(1)
      expect(storage.identity.current()).toBe(ACCOUNT)
    })
  })

  describe('presence', () => {
    it('publishes a live lease on connect and an expired one on the last close', async () => {
      const presence = { publish: vi.fn(async () => {}) }
      const runtime = build(presence)
      const { sid } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000, uid: ACCOUNT,
      }) as { sid: string }
      const socket = fakeSocket()
      await runtime.accept(socket, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })
      expect(presence.publish).toHaveBeenLastCalledWith(ACCOUNT, nowMs + LIMITS.presenceLeaseMs)

      sockets = []
      await runtime.onClose(socket)
      expect(presence.publish).toHaveBeenLastCalledWith(ACCOUNT, nowMs)
    })

    it('keeps the account online while another socket remains', async () => {
      const presence = { publish: vi.fn(async () => {}) }
      const runtime = build(presence)
      const { sid } = runtime.registerSession({
        deviceKeyId: DEVICE_A, nowMs, ttlMs: 60_000, uid: ACCOUNT,
      }) as { sid: string }
      const first = fakeSocket()
      const second = fakeSocket()
      await runtime.accept(first, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })
      await runtime.accept(second, { uid: ACCOUNT, deviceKeyId: DEVICE_A, sid })
      presence.publish.mockClear()
      // `first` is still listed by the runtime during its own close.
      await runtime.onClose(first)
      expect(presence.publish).not.toHaveBeenCalled()
    })

    it('does nothing when no presence shard is bound', async () => {
      const runtime = build(null)
      await expect(runtime.onClose(fakeSocket())).resolves.toBeUndefined()
    })
  })

  describe('alarm', () => {
    it('prunes expired state and reschedules', async () => {
      const runtime = build()
      storage.nonces.consume('old', nowMs - 1)
      storage.idempotency.remember('cmd', 'ack', nowMs - 1)
      storage.sessions.insert({
        sid: 'stale', deviceKeyId: DEVICE_A as DeviceKeyId, epoch: 0,
        createdAtMs: 0, expiresAtMs: nowMs - 1,
      })
      await runtime.onAlarm()
      expect(storage.sessions.all()).toHaveLength(0)
      expect(storage.idempotency.recall('cmd')).toBeUndefined()
    })

    it('schedules to the earliest pending expiry', async () => {
      const runtime = build()
      storage.nonces.consume('late', nowMs + 90_000)
      storage.idempotency.remember('cmd', 'ack', nowMs + 5_000)
      await runtime.scheduleAlarm()
      expect(alarms[alarms.length - 1]).toBe(nowMs + 5_000)
    })

    it('runs an app alarm hook alongside the shared cleanup', async () => {
      const onAlarm = vi.fn()
      const runtime = new GatewayRuntime({
        ctx,
        storage,
        clock: { nowMs: () => nowMs },
        random: { uuid: () => 'uuid' },
        registry: coreCommands(),
        handlers: {},
        presence: null,
        snapshot: () => ({}),
        onAlarm,
      })
      await runtime.onAlarm()
      expect(onAlarm).toHaveBeenCalledWith(nowMs)
    })
  })

  describe('identity', () => {
    it('never invents an account id — it only ever remembers one it was given', () => {
      // The failure this guards: identity used to be parsed out of the object's
      // own id, which is undefined inside a Durable Object, so every account
      // in both apps ran as the same empty string.
      const runtime = build()
      expect(storage.identity.current()).toBeNull()
      runtime.consumeNonce('hash', nowMs + 1_000)
      expect(storage.identity.current()).toBeNull()
      runtime.consumeNonce('hash-2', nowMs + 1_000, ACCOUNT)
      expect(storage.identity.current()).toBe(ACCOUNT)
    })

    it('ignores an identity that is not a well-formed opaque id', () => {
      const runtime = build()
      runtime.consumeNonce('hash', nowMs + 1_000, 'short')
      expect(storage.identity.current()).toBeNull()
    })
  })
})

export type { OpaqueUserId }
