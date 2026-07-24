import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { CLOSE } from './protocol.mjs'

function scope(name) {
  return env.SIGNAL_SCOPES.getByName(name)
}

async function connect(stub, uid, dk) {
  const response = await stub.fetch('http://do/', { headers: { upgrade: 'websocket', 'x-realtime-uid': uid, 'x-realtime-dk': dk } })
  expect(response.status).toBe(101)
  const ws = response.webSocket
  ws.accept()
  return ws
}

function nextMessage(ws) {
  return new Promise(resolve => ws.addEventListener('message', event => resolve(JSON.parse(event.data)), { once: true }))
}

describe('SignalScopeDO', () => {
  it('rejects an upgrade without a live authorization row', async () => {
    const stub = scope('peerly:scope-1')
    const response = await stub.fetch('http://do/', { headers: { 'x-realtime-uid': 'u1', 'x-realtime-dk': 'dk1' } })
    expect(response.status).toBe(403)
  })

  it('forwards an opaque signal frame between two authorized peers with a from field', async () => {
    const stub = scope('peerly:scope-2')
    const now = Date.now()
    await stub.authorize({ uid: 'u1', dk: 'dk1', expiresAt: now + 60_000 })
    await stub.authorize({ uid: 'u2', dk: 'dk2', expiresAt: now + 60_000 })

    const wsA = await connect(stub, 'u1', 'dk1')
    const joinAnnounce = nextMessage(wsA) // peer.join, sent once wsB connects
    const wsB = await connect(stub, 'u2', 'dk2')
    await joinAnnounce

    const received = nextMessage(wsB)
    wsA.send(JSON.stringify({ v: 1, id: 's1', type: 'signal', sentAt: Date.now(), payload: { sdp: 'opaque-offer' } }))
    const frame = await received
    expect(frame.type).toBe('signal')
    expect(frame.payload.sdp).toBe('opaque-offer')
    expect(frame.payload.from).toBeTruthy()
    wsA.close()
    wsB.close()
  })

  it('never authorizes access across two different scopes', async () => {
    const stubA = scope('peerly:scope-isolation-a')
    const stubB = scope('peerly:scope-isolation-b')
    await stubA.authorize({ uid: 'u1', dk: 'dk1', expiresAt: Date.now() + 60_000 })
    const responseOnB = await stubB.fetch('http://do/', { headers: { 'x-realtime-uid': 'u1', 'x-realtime-dk': 'dk1' } })
    expect(responseOnB.status).toBe(403)
  })

  it('enforces the participants-per-scope cap', async () => {
    const stub = scope('peerly:scope-cap-1')
    const now = Date.now()
    for (let i = 0; i < 17; i += 1) {
      await stub.authorize({ uid: `u${i}`, dk: `dk${i}`, expiresAt: now + 60_000 })
    }
    for (let i = 0; i < 16; i += 1) {
      const response = await stub.fetch('http://do/', { headers: { upgrade: 'websocket', 'x-realtime-uid': `u${i}`, 'x-realtime-dk': `dk${i}` } })
      expect(response.status).toBe(101)
      response.webSocket.accept()
    }
    const overflow = await stub.fetch('http://do/', { headers: { upgrade: 'websocket', 'x-realtime-uid': 'u16', 'x-realtime-dk': 'dk16' } })
    expect(overflow.status).toBe(409)
  })

  it('clears storage once the authorization expires and no socket remains', async () => {
    const stub = scope('peerly:scope-cleanup-1')
    const now = Date.now()
    await stub.authorize({ uid: 'u1', dk: 'dk1', expiresAt: now + 60_000 })
    const ws = await connect(stub, 'u1', 'dk1')
    ws.close()
    await runInDurableObject(stub, async (instance, state) => {
      // Simulate the authorization having already expired, then run the same
      // alarm handler production relies on to prune and self-clean. With no
      // sockets and no rows left, alarm() calls storage.deleteAll() — so the
      // table itself is gone afterward, not just empty.
      state.storage.sql.exec('UPDATE authorizations SET expires_at = ? WHERE uid = ?', now - 1, 'u1')
      await instance.alarm()
      const tables = state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='authorizations'").toArray()
      expect(tables.length).toBe(0)
    })
  })

  it('routes a claimed topic to its listener instead of broadcasting to the room', async () => {
    const stub = scope('peerly:topic-routing')
    const expiresAt = Date.now() + 60_000
    for (const dk of ['dk-a', 'dk-b', 'dk-c']) {
      await stub.authorize({ uid: 'topic-uid', dk, expiresAt })
    }

    const open = async dk => {
      const response = await stub.fetch('http://do/', {
        headers: { upgrade: 'websocket', 'x-realtime-uid': 'topic-uid', 'x-realtime-dk': dk },
      })
      const ws = response.webSocket
      const frames = []
      ws.accept()
      // Only signal frames: a later participant's connect also emits a
      // peer.join announcement to everyone already here.
      ws.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.type === 'signal') frames.push(frame)
      })
      return { ws, frames }
    }
    const a = await open('dk-a')
    const b = await open('dk-b')
    const c = await open('dk-c')

    // b claims the per-peer topic a will address; c claims nothing relevant.
    b.ws.send(JSON.stringify({
      v: 1, id: 'sub-b', type: 'signal', sentAt: Date.now(), payload: { subscribe: ['peer-b'] },
    }))
    expect(b.frames.length).toBe(0)

    a.ws.send(JSON.stringify({
      v: 1, id: 'sig-1', type: 'signal', sentAt: Date.now(),
      payload: { topic: 'peer-b', message: 'offer-envelope' },
    }))
    await vi.waitFor(() => expect(b.frames.length).toBe(1))
    expect(b.frames[0].payload.message).toBe('offer-envelope')
    // The uninvolved third participant never sees the pair's envelope — the
    // whole point of routing rather than broadcasting.
    expect(c.frames.length).toBe(0)
  })

  it('still broadcasts a topic nobody has claimed, so the room-wide announce works', async () => {
    const stub = scope('peerly:topic-broadcast')
    const expiresAt = Date.now() + 60_000
    for (const dk of ['dk-a', 'dk-b']) await stub.authorize({ uid: 'bcast-uid', dk, expiresAt })
    const open = async dk => {
      const response = await stub.fetch('http://do/', {
        headers: { upgrade: 'websocket', 'x-realtime-uid': 'bcast-uid', 'x-realtime-dk': dk },
      })
      const ws = response.webSocket
      const frames = []
      ws.accept()
      // Only signal frames: a later participant's connect also emits a
      // peer.join announcement to everyone already here.
      ws.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.type === 'signal') frames.push(frame)
      })
      return { ws, frames }
    }
    const a = await open('dk-a')
    const b = await open('dk-b')
    a.ws.send(JSON.stringify({
      v: 1, id: 'sig-2', type: 'signal', sentAt: Date.now(),
      payload: { topic: 'room-wide', message: 'announce' },
    }))
    await vi.waitFor(() => expect(b.frames.some(frame => frame.payload?.message === 'announce')).toBe(true))
  })

  it('release closes the leaving device socket and drops its authorization', async () => {
    const stub = scope('peerly:scope-release')
    await stub.authorize({ uid: 'release-uid', dk: 'dk-a', expiresAt: Date.now() + 60_000 })
    const response = await stub.fetch('http://do/', {
      headers: { upgrade: 'websocket', 'x-realtime-uid': 'release-uid', 'x-realtime-dk': 'dk-a' },
    })
    const ws = response.webSocket
    ws.accept()
    const closed = new Promise(resolve => ws.addEventListener('close', resolve, { once: true }))
    await stub.release({ uid: 'release-uid', dk: 'dk-a' })
    expect((await closed).code).toBe(CLOSE.AUTH_REQUIRED)

    // A second upgrade is refused now that the authorization is gone.
    const again = await stub.fetch('http://do/', {
      headers: { upgrade: 'websocket', 'x-realtime-uid': 'release-uid', 'x-realtime-dk': 'dk-a' },
    })
    expect(again.status).toBe(403)
  })
})
