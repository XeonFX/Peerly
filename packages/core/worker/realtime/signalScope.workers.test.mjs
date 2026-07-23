import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

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
})
