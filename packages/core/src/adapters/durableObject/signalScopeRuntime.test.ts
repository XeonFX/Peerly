import { beforeEach, describe, expect, it } from 'vitest'
import { SignalScopeRuntime, type ScopeSocket, type ScopeStore, type Authorization } from './signalScopeRuntime.js'
import { claimableTopics, isScopeAbandoned, routeSignal } from '../../domain/signalRouting.js'
import { CLOSE, LIMITS } from '../../protocol/index.js'

function fakeSocket(): ScopeSocket & { sent: string[]; closed: number[] } {
  let attachment: unknown = null
  const sent: string[] = []
  const closed: number[] = []
  return {
    sent,
    closed,
    send: data => { sent.push(data) },
    close: code => { closed.push(code) },
    serializeAttachment: value => { attachment = value },
    deserializeAttachment: () => attachment,
  }
}

function memoryStore(): ScopeStore {
  const rows = new Map<string, Authorization>()
  const key = (uid: string, dk: string) => `${uid}\n${dk}`
  return {
    authorize: record => { rows.set(key(record.uid, record.deviceKeyId), record) },
    find: (uid, dk) => rows.get(key(uid, dk)),
    remove: (uid, dk) => { rows.delete(key(uid, dk)) },
    count: () => rows.size,
    deleteExpired: nowMs => {
      for (const [id, row] of rows) if (row.expiresAtMs <= nowMs) rows.delete(id)
    },
    earliestExpiryMs: () =>
      rows.size === 0 ? null : Math.min(...[...rows.values()].map(row => row.expiresAtMs)),
  }
}

const signal = (payload: unknown) =>
  JSON.stringify({ v: 1, id: 'sig', type: 'signal', sentAt: Date.now(), payload })

describe('signal routing rules', () => {
  const participants = [
    { cid: 'a', topics: ['room', 'peer-a'] },
    { cid: 'b', topics: ['room', 'peer-b'] },
    { cid: 'c', topics: ['room'] },
  ]

  it('routes an addressed frame to exactly one peer', () => {
    expect(routeSignal({ to: 'b' }, participants, 'a')).toEqual({ kind: 'direct', cid: 'b' })
  })

  it('routes a claimed topic to its listeners, excluding the sender', () => {
    expect(routeSignal({ topic: 'peer-b' }, participants, 'a')).toEqual({ kind: 'topic', cids: ['b'] })
    expect(routeSignal({ topic: 'room' }, participants, 'a')).toEqual({ kind: 'topic', cids: ['b', 'c'] })
  })

  it('broadcasts a topic nobody has claimed yet', () => {
    // A peer that has not claimed its topic would otherwise miss the very
    // offer trying to reach it.
    expect(routeSignal({ topic: 'unclaimed' }, participants, 'a')).toEqual({ kind: 'broadcast' })
  })

  it('broadcasts when there is no routing information at all', () => {
    expect(routeSignal({}, participants, 'a')).toEqual({ kind: 'broadcast' })
  })
})

describe('topic claims', () => {
  it('caps the number of topics', () => {
    const many = Array.from({ length: 50 }, (_, index) => `topic-${index}`)
    expect(claimableTopics(many, 0)).toHaveLength(LIMITS.topicsPerParticipant)
  })

  it('trims rather than throws when the attachment budget runs out', () => {
    // Exceeding the runtime's attachment cap throws inside the message
    // handler and loses the socket; dropping a topic only costs a broadcast.
    const long = Array.from({ length: 8 }, () => 'x'.repeat(250))
    expect(claimableTopics(long, LIMITS.attachmentBytes - 300).length).toBeLessThan(8)
  })

  it('ignores entries that are not usable topics', () => {
    expect(claimableTopics([42, '', null, 'ok'], 0)).toEqual(['ok'])
  })
})

describe('scope lifetime', () => {
  it('is abandoned only with no sockets and no authorizations', () => {
    expect(isScopeAbandoned(0, 0)).toBe(true)
    expect(isScopeAbandoned(1, 0)).toBe(false)
    expect(isScopeAbandoned(0, 1)).toBe(false)
  })
})

describe('SignalScopeRuntime', () => {
  let sockets: ReturnType<typeof fakeSocket>[]
  let store: ScopeStore
  let deleted: number
  let alarms: number[]
  let nowMs: number

  const ctx = {
    getWebSockets: () => sockets,
    acceptWebSocket: (socket: ScopeSocket) => {
      if (!sockets.includes(socket as ReturnType<typeof fakeSocket>)) {
        sockets.push(socket as ReturnType<typeof fakeSocket>)
      }
    },
    storage: {
      setAlarm: async (at: number) => { alarms.push(at) },
      getAlarm: async () => alarms[alarms.length - 1] ?? null,
      deleteAll: async () => { deleted += 1 },
    },
  }

  let uuid = 0
  const build = () => new SignalScopeRuntime({
    ctx,
    store,
    clock: { nowMs: () => nowMs },
    random: { uuid: () => `cid-${++uuid}` },
  })

  const admit = async (runtime: SignalScopeRuntime, uid: string, dk: string) => {
    await runtime.authorize({ uid, deviceKeyId: dk, expiresAtMs: nowMs + 60_000 })
    const socket = fakeSocket()
    expect(runtime.accept(socket, { uid, deviceKeyId: dk })).toEqual({ ok: true })
    return socket
  }

  beforeEach(() => {
    sockets = []
    store = memoryStore()
    deleted = 0
    alarms = []
    nowMs = 1_000
    uuid = 0
  })

  it('refuses a socket with no live authorization', () => {
    expect(build().accept(fakeSocket(), { uid: 'u', deviceKeyId: 'd' })).toEqual({ ok: false, status: 403 })
  })

  it('refuses a socket whose authorization has expired', async () => {
    const runtime = build()
    await runtime.authorize({ uid: 'u', deviceKeyId: 'd', expiresAtMs: nowMs })
    expect(runtime.accept(fakeSocket(), { uid: 'u', deviceKeyId: 'd' })).toEqual({ ok: false, status: 403 })
  })

  it('refuses a participant beyond the scope cap', async () => {
    const runtime = build()
    for (let index = 0; index < LIMITS.participantsPerScope; index += 1) {
      await admit(runtime, `u${index}`, `d${index}`)
    }
    await runtime.authorize({ uid: 'extra', deviceKeyId: 'd', expiresAtMs: nowMs + 60_000 })
    expect(runtime.accept(fakeSocket(), { uid: 'extra', deviceKeyId: 'd' })).toEqual({ ok: false, status: 409 })
  })

  it('caps stored authorizations', async () => {
    const runtime = build()
    for (let index = 0; index < LIMITS.participantsPerScope * 2; index += 1) {
      await runtime.authorize({ uid: `u${index}`, deviceKeyId: 'd', expiresAtMs: nowMs + 60_000 })
    }
    expect(await runtime.authorize({ uid: 'one-too-many', deviceKeyId: 'd', expiresAtMs: nowMs + 60_000 }))
      .toEqual({ code: 'cap-exceeded' })
  })

  it('never delays an earlier alarm with a later authorization', async () => {
    const runtime = build()
    await runtime.authorize({ uid: 'early', deviceKeyId: 'd', expiresAtMs: nowMs + 1_000 })
    await runtime.authorize({ uid: 'late', deviceKeyId: 'd', expiresAtMs: nowMs + 90_000 })
    expect(alarms[alarms.length - 1]).toBe(nowMs + 1_000)
  })

  it('tells existing participants when someone joins', async () => {
    const runtime = build()
    const first = await admit(runtime, 'u1', 'd1')
    await admit(runtime, 'u2', 'd2')
    expect(JSON.parse(first.sent[0]).type).toBe('peer.join')
  })

  it('delivers an addressed frame to one peer only', async () => {
    const runtime = build()
    const a = await admit(runtime, 'u1', 'd1')
    const b = await admit(runtime, 'u2', 'd2')
    const c = await admit(runtime, 'u3', 'd3')
    const target = (b.deserializeAttachment() as { cid: string }).cid
    b.sent.length = 0
    c.sent.length = 0

    runtime.onMessage(a, signal({ to: target, sdp: 'offer' }))
    expect(b.sent.map(frame => JSON.parse(frame).payload.sdp)).toEqual(['offer'])
    expect(c.sent).toHaveLength(0)
  })

  it('delivers a claimed topic to its listener and nobody else', async () => {
    const runtime = build()
    const a = await admit(runtime, 'u1', 'd1')
    const b = await admit(runtime, 'u2', 'd2')
    const c = await admit(runtime, 'u3', 'd3')
    runtime.onMessage(b, signal({ subscribe: ['peer-b'] }))
    b.sent.length = 0
    c.sent.length = 0

    runtime.onMessage(a, signal({ topic: 'peer-b', sdp: 'offer' }))
    expect(b.sent).toHaveLength(1)
    expect(c.sent).toHaveLength(0)
  })

  it('stamps the sender so a peer can answer', async () => {
    const runtime = build()
    const a = await admit(runtime, 'u1', 'd1')
    const b = await admit(runtime, 'u2', 'd2')
    b.sent.length = 0
    runtime.onMessage(a, signal({ sdp: 'offer' }))
    const from = JSON.parse(b.sent[0]).payload.from
    expect(from).toBe((a.deserializeAttachment() as { cid: string }).cid)
  })

  it('closes a socket that floods the scope', async () => {
    const runtime = build()
    const a = await admit(runtime, 'u1', 'd1')
    await admit(runtime, 'u2', 'd2')
    for (let index = 0; index < LIMITS.signalsBurst; index += 1) {
      runtime.onMessage(a, signal({ sdp: 'x' }))
    }
    runtime.onMessage(a, signal({ sdp: 'x' }))
    expect(a.closed).toContain(CLOSE.RATE_LIMIT_ABUSE)
  })

  it('closes on a malformed frame and answers a bad payload without closing', async () => {
    const runtime = build()
    const a = await admit(runtime, 'u1', 'd1')
    runtime.onMessage(a, 'not json')
    expect(a.closed).toContain(CLOSE.MALFORMED_FRAME)

    const b = await admit(runtime, 'u2', 'd2')
    b.sent.length = 0
    runtime.onMessage(b, signal({ to: 42 }))
    expect(JSON.parse(b.sent[0]).payload.code).toBe('invalid-frame')
    expect(b.closed).toHaveLength(0)
  })

  it('release closes that device socket and drops its authorization', async () => {
    const runtime = build()
    const socket = await admit(runtime, 'u1', 'd1')
    await runtime.release('u1', 'd1')
    expect(socket.closed).toContain(CLOSE.AUTH_REQUIRED)
    expect(store.find('u1', 'd1')).toBeUndefined()
  })

  it('clears storage once the last socket leaves and nothing is authorized', async () => {
    const runtime = build()
    const socket = await admit(runtime, 'u1', 'd1')
    store.remove('u1', 'd1')
    sockets = [socket] // the runtime still lists the closing socket
    await runtime.onClose(socket)
    expect(deleted).toBe(1)
  })

  it('keeps storage while another participant remains', async () => {
    const runtime = build()
    const first = await admit(runtime, 'u1', 'd1')
    await admit(runtime, 'u2', 'd2')
    await runtime.onClose(first)
    expect(deleted).toBe(0)
  })

  it('prunes expired authorizations on its alarm and reschedules', async () => {
    const runtime = build()
    await runtime.authorize({ uid: 'gone', deviceKeyId: 'd', expiresAtMs: nowMs - 1 })
    await runtime.authorize({ uid: 'stays', deviceKeyId: 'd', expiresAtMs: nowMs + 50_000 })
    await runtime.onAlarm()
    expect(store.count()).toBe(1)
    expect(alarms[alarms.length - 1]).toBe(nowMs + 50_000)
  })
})
