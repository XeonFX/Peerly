import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeClient } from './realtimeClient.js'
import { CLIENT_TIMINGS, CLOSE, encodeAck, encodeDelta, encodeError } from '../protocol/index.js'
import type {
  ChannelEvents, ControlChannel, EnrollResult, KeyValueStore, SessionApi, SessionResult, Timers,
} from '../ports/client.js'

/**
 * The browser control client, with no browser.
 *
 * The client it replaces had no tests at all — it reached straight for fetch,
 * WebSocket, location and IndexedDB — and it is where an enrolment loop, a
 * missing session refresh and an in-memory resume cursor each shipped. Every
 * one of those is a named case below.
 */

/** Runs timers by hand so backoff and refresh intervals are exercised without
 *  waiting for them. */
function fakeTimers() {
  let handle = 0
  const timeouts = new Map<number, { run: () => void; at: number }>()
  const intervals = new Map<number, { run: () => void; every: number }>()
  let now = 0
  const timers: Timers = {
    setTimeout: (run, ms) => { handle += 1; timeouts.set(handle, { run, at: now + ms }); return handle },
    clearTimeout: id => { timeouts.delete(id) },
    setInterval: (run, every) => { handle += 1; intervals.set(handle, { run, every }); return handle },
    clearInterval: id => { intervals.delete(id) },
  }
  return {
    timers,
    advance(ms: number) {
      now += ms
      for (const [id, entry] of [...timeouts]) {
        if (entry.at <= now) { timeouts.delete(id); entry.run() }
      }
    },
    fireIntervals() {
      for (const entry of [...intervals.values()]) entry.run()
    },
    get pendingIntervals() { return intervals.size },
  }
}

function fakeStore(initial: Record<string, string | number> = {}): KeyValueStore & { values: Record<string, string | number> } {
  const values = { ...initial }
  return {
    values,
    get: async key => values[key],
    set: async (key, value) => { values[key] = value },
  }
}

function fakeChannels() {
  const sent: string[] = []
  let events: ChannelEvents | null = null
  let open = false
  const channel: ControlChannel = {
    send: frame => { sent.push(frame) },
    close: () => { open = false },
    get open() { return open },
  }
  return {
    sent,
    frames: () => sent.filter(frame => frame !== 'ping').map(frame => JSON.parse(frame)),
    factory: {
      connect(next: ChannelEvents) {
        events = next
        return channel
      },
    },
    accept() {
      open = true
      events?.onOpen()
    },
    deliver(raw: string) { events?.onFrame(raw) },
    drop(code = 1006) {
      open = false
      events?.onClose(code)
    },
    get connected() { return events !== null },
  }
}

describe('RealtimeClient', () => {
  let api: SessionApi & { enroll: ReturnType<typeof vi.fn>; establish: ReturnType<typeof vi.fn> }
  let store: ReturnType<typeof fakeStore>
  let channels: ReturnType<typeof fakeChannels>
  let clock: ReturnType<typeof fakeTimers>

  const enrolled: EnrollResult = { kind: 'capability', capability: 'cap-1' }
  const established: SessionResult = { kind: 'established', turn: { urls: ['turn:x'] } }

  const build = () => new RealtimeClient({
    api,
    channels: channels.factory,
    store,
    timers: clock.timers,
    random: () => 0.5,
  })

  /** Connect and complete the open handshake. */
  const connect = async (client: RealtimeClient) => {
    const connecting = client.connect()
    await vi.waitFor(() => expect(channels.connected).toBe(true))
    channels.accept()
    await connecting
  }

  beforeEach(() => {
    api = {
      enroll: vi.fn(async () => enrolled),
      establish: vi.fn(async () => established),
    } as never
    store = fakeStore()
    channels = fakeChannels()
    clock = fakeTimers()
  })

  describe('enrolment', () => {
    it('enrols once and reuses the stored capability', async () => {
      const client = build()
      await connect(client)
      expect(store.values.capability).toBe('cap-1')

      client.close()
      channels = fakeChannels()
      await connect(build())
      expect(api.enroll).toHaveBeenCalledTimes(1)
    })

    it('re-enrols when the stored capability was cleared to an empty string', async () => {
      // The bug this replaces: '' is still a string, so a truthiness-free
      // check resent it forever and the server 400s an empty capability
      // instead of 401ing it back into a re-enrol.
      store = fakeStore({ capability: '' })
      await connect(build())
      expect(api.enroll).toHaveBeenCalledTimes(1)
    })

    it('discards a rejected capability rather than retrying it', async () => {
      api.establish.mockResolvedValueOnce({ kind: 'rejected' })
      const client = build()
      void client.connect()
      await vi.waitFor(() => expect(store.values.capability).toBe(''))
      expect(client.currentState).toBe('backoff')
    })

    it('backs off when enrolment conflicts', async () => {
      api.enroll.mockResolvedValue({ kind: 'conflict' })
      const client = build()
      await client.connect()
      expect(client.currentState).toBe('backoff')
    })
  })

  describe('session refresh', () => {
    it('re-establishes on a live socket and re-announces TURN', async () => {
      // Both the session cookie and the TURN credential expire on a wall
      // clock. Without this a tab connected past the TTL could no longer open
      // a signalling socket and offered peers expired credentials.
      const client = build()
      const turns: unknown[] = []
      client.addEventListener('turn', event => turns.push((event as CustomEvent).detail))
      await connect(client)
      expect(turns).toHaveLength(1)

      clock.fireIntervals()
      await vi.waitFor(() => expect(turns).toHaveLength(2))
      expect(api.establish).toHaveBeenCalledTimes(2)
    })

    it('keeps the socket when a refresh fails', async () => {
      const client = build()
      await connect(client)
      api.establish.mockRejectedValueOnce(new Error('offline'))
      clock.fireIntervals()
      await vi.waitFor(() => expect(client.currentState).toBe('ready'))
    })

    it('stops its timers once the socket drops', async () => {
      const client = build()
      await connect(client)
      expect(clock.pendingIntervals).toBeGreaterThan(0)
      channels.drop()
      expect(clock.pendingIntervals).toBe(0)
    })
  })

  describe('resume', () => {
    it('persists the cursor and resumes from it on a later connect', async () => {
      // Held only in memory before, so every page load resumed from 0 and the
      // server replayed its whole retention window.
      const client = build()
      await connect(client)
      channels.deliver(encodeDelta('d1', [{ kind: 'ring', body: {} }], 7))
      clock.advance(CLIENT_TIMINGS.resumeSaveDebounceMs)
      await vi.waitFor(() => expect(store.values.resumeSeq).toBe(7))

      client.close()
      channels = fakeChannels()
      await connect(build())
      const hello = channels.frames().find(frame => frame.type === 'hello')
      expect(hello.payload.resumeSeq).toBe(7)
    })

    it('flushes a pending cursor write when the socket drops', async () => {
      const client = build()
      await connect(client)
      channels.deliver(encodeDelta('d1', [{ kind: 'ring', body: {} }], 3))
      channels.drop()
      await vi.waitFor(() => expect(store.values.resumeSeq).toBe(3))
    })
  })

  describe('commands', () => {
    it('resolves with the ack result', async () => {
      const client = build()
      await connect(client)
      const promise = client.send('scope.request', { kind: 'room', capability: 'c' })
      const sent = channels.frames().find(frame => frame.type === 'scope.request')
      channels.deliver(encodeAck(sent.id, { routeId: 'r1' }))
      expect(await promise).toEqual({ routeId: 'r1' })
    })

    it('rejects on an error frame', async () => {
      const client = build()
      await connect(client)
      const promise = client.send('invite.ack', { inviteId: 'i' })
      const sent = channels.frames().find(frame => frame.type === 'invite.ack')
      channels.deliver(encodeError('conflict', { forId: sent.id }))
      await expect(promise).rejects.toThrow(/conflict/)
    })

    it('times out a command that is never answered', async () => {
      const client = build()
      await connect(client)
      const promise = client.send('ring.send', { to: 'x', roomRoute: 'r' })
      clock.advance(CLIENT_TIMINGS.commandTimeoutMs)
      await expect(promise).rejects.toThrow('timeout')
    })

    it('queues before the socket opens and flushes on open', async () => {
      const client = build()
      const promise = client.send('invite.ack', { inviteId: 'queued' })
      const connecting = client.connect()
      await vi.waitFor(() => expect(channels.connected).toBe(true))
      channels.accept()
      await connecting
      const sent = channels.frames().find(frame => frame.type === 'invite.ack')
      expect(sent).toBeTruthy()
      channels.deliver(encodeAck(sent.id))
      await expect(promise).resolves.toBeUndefined()
    })

    it('requeues an unanswered command across a reconnect', async () => {
      const client = build()
      await connect(client)
      void client.send('invite.ack', { inviteId: 'survives' })
      channels.drop()
      channels.accept()
      expect(channels.frames().filter(frame => frame.type === 'invite.ack')).toHaveLength(2)
    })

    it('refuses to queue past its cap', async () => {
      const client = build()
      for (let index = 0; index < CLIENT_TIMINGS.commandQueueMax; index += 1) {
        void client.send('invite.ack', { inviteId: `i${index}` }).catch(() => {})
      }
      await expect(client.send('invite.ack', { inviteId: 'overflow' })).rejects.toThrow('queue-full')
    })

    it('gives every command a distinct id', async () => {
      const client = build()
      await connect(client)
      void client.send('invite.ack', { inviteId: 'a' })
      void client.send('invite.ack', { inviteId: 'b' })
      const ids = channels.frames().filter(frame => frame.type === 'invite.ack').map(frame => frame.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('events', () => {
    it('dispatches one event per delta entry, by kind', async () => {
      const client = build()
      const rings: unknown[] = []
      client.addEventListener('ring', event => rings.push((event as CustomEvent).detail))
      await connect(client)
      channels.deliver(encodeDelta('d1', [
        { kind: 'ring', body: { from: 'a' } },
        { kind: 'ring', body: { from: 'b' } },
      ], 2))
      expect(rings).toHaveLength(2)
    })

    it('ignores a pong and any frame it cannot parse', async () => {
      const client = build()
      await connect(client)
      expect(() => { channels.deliver('pong'); channels.deliver('{{{') }).not.toThrow()
    })
  })

  describe('lifecycle', () => {
    it('reaches the terminal upgrade state on a version close', async () => {
      const client = build()
      const connecting = client.connect()
      await vi.waitFor(() => expect(channels.connected).toBe(true))
      channels.accept()
      await connecting
      channels.drop(CLOSE.VERSION_UNSUPPORTED)
      // Terminal: retrying against a server that cannot speak our protocol is
      // pure noise. The close can arrive long after the handshake resolved, so
      // the state has to be applied directly rather than by rejecting it.
      expect(client.currentState).toBe('upgrade-required')
      clock.advance(CLIENT_TIMINGS.reconnectCapMs)
      expect(api.establish).toHaveBeenCalledTimes(1)
    })

    it('reconnects with backoff after an unexpected drop', async () => {
      const client = build()
      await connect(client)
      channels.drop()
      expect(client.currentState).toBe('backoff')
      clock.advance(CLIENT_TIMINGS.reconnectCapMs)
      await vi.waitFor(() => expect(api.establish).toHaveBeenCalledTimes(2))
    })

    it('does not reconnect after an explicit close', async () => {
      const client = build()
      await connect(client)
      client.close()
      channels.drop()
      clock.advance(CLIENT_TIMINGS.reconnectCapMs)
      expect(client.currentState).toBe('offline')
    })

    it('fails in-flight commands immediately on close', async () => {
      const client = build()
      await connect(client)
      const promise = client.send('invite.ack', { inviteId: 'x' })
      client.close()
      await expect(promise).rejects.toThrow('client-closed')
    })

    it('reports its state transitions', async () => {
      const client = build()
      const states: string[] = []
      client.addEventListener('state', event => states.push((event as CustomEvent).detail))
      await connect(client)
      expect(states).toEqual(['enrolling', 'session', 'connecting', 'ready'])
    })
  })
})
