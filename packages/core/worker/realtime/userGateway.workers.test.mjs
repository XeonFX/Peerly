import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { CLOSE } from './protocol.mjs'

function gateway(name) {
  return env.USER_GATEWAYS.getByName(name)
}

describe('UserGatewayDO RPC', () => {
  it('evicts the least-recently-enrolled device when a 4th distinct device enrolls', async () => {
    const stub = gateway('peerly:cap-test-1')
    const now = Date.now()
    // Stagger enroll times so "least recently enrolled" is unambiguous.
    const a = await stub.registerSession({ dk: 'dk-a', now, ttlMs: 60_000 })
    const b = await stub.registerSession({ dk: 'dk-b', now: now + 1, ttlMs: 60_000 })
    const c = await stub.registerSession({ dk: 'dk-c', now: now + 2, ttlMs: 60_000 })
    expect(a.sid).toBeTruthy()
    expect(b.sid).toBeTruthy()
    expect(c.sid).toBeTruthy()

    // The 4th device is admitted (no lockout) by bumping the oldest, dk-a.
    const d = await stub.registerSession({ dk: 'dk-d', now: now + 3, ttlMs: 60_000 })
    expect(d.sid).toBeTruthy()

    // dk-a's session is gone; dk-b/dk-c/dk-d remain valid.
    expect((await stub.validateSession({ sid: a.sid, dk: 'dk-a', epoch: a.epoch })).ok).toBe(false)
    expect((await stub.validateSession({ sid: b.sid, dk: 'dk-b', epoch: b.epoch })).ok).toBe(true)
    expect((await stub.validateSession({ sid: c.sid, dk: 'dk-c', epoch: c.epoch })).ok).toBe(true)
    expect((await stub.validateSession({ sid: d.sid, dk: 'dk-d', epoch: d.epoch })).ok).toBe(true)
  })

  it('allows re-registering an already-live device without hitting the cap', async () => {
    const stub = gateway('peerly:cap-test-2')
    const now = Date.now()
    await stub.registerSession({ dk: 'dk-a', now, ttlMs: 60_000 })
    await stub.registerSession({ dk: 'dk-b', now, ttlMs: 60_000 })
    await stub.registerSession({ dk: 'dk-c', now, ttlMs: 60_000 })
    const again = await stub.registerSession({ dk: 'dk-a', now, ttlMs: 60_000 })
    expect(again.sid).toBeTruthy()
  })

  it('validates a live session and rejects a mismatched epoch after revocation', async () => {
    const stub = gateway('peerly:session-test-1')
    const now = Date.now()
    const { sid, epoch } = await stub.registerSession({ dk: 'dk-a', now, ttlMs: 60_000 })
    expect((await stub.validateSession({ sid, dk: 'dk-a', epoch })).ok).toBe(true)
    await stub.revokeDevice('dk-a')
    expect((await stub.validateSession({ sid, dk: 'dk-a', epoch })).ok).toBe(false)
  })

  it('rejects nonce replay', async () => {
    const stub = gateway('peerly:nonce-test-1')
    const now = Date.now()
    expect(await stub.consumeNonce('hash-1', now + 60_000)).toBe(true)
    expect(await stub.consumeNonce('hash-1', now + 60_000)).toBe(false)
    expect(await stub.consumeNonce('hash-2', now + 60_000)).toBe(true)
  })

  it('drops the oldest mailbox entry once the cap is reached', async () => {
    const stub = gateway('peerly:mailbox-test-1')
    for (let i = 0; i < 101; i += 1) {
      await stub.deliver({ mailbox: { invite_id: `invite-${i}`, body: JSON.stringify({ i }) } })
    }
    await runInDurableObject(stub, async (_instance, state) => {
      const count = state.storage.sql.exec('SELECT COUNT(*) AS n FROM mailbox').toArray()[0].n
      expect(count).toBe(100)
      const oldest = state.storage.sql.exec('SELECT invite_id FROM mailbox WHERE invite_id = ?', 'invite-0').toArray()
      expect(oldest.length).toBe(0)
      const newest = state.storage.sql.exec('SELECT invite_id FROM mailbox WHERE invite_id = ?', 'invite-100').toArray()
      expect(newest.length).toBe(1)
    })
  })

  it('two-phase match reservation: reserve, commit, and idempotent re-commit', async () => {
    const stub = gateway('peerly:match-test-1')
    const now = Date.now()
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO seek (one, seek_id, state, expires_at) VALUES (1, 'seek-1', 'seeking', ?)", now + 60_000
      )
    })
    const reserved = await stub.reserveForMatch({ reservationId: 'r1', queueKey: 'q1', seekId: 'seek-1', expiresAt: now + 30_000 })
    expect(reserved).toEqual({ ok: true })

    const busy = await stub.reserveForMatch({ reservationId: 'r2', queueKey: 'q1', seekId: 'seek-1', expiresAt: now + 30_000 })
    expect(busy).toEqual({ busy: true })

    await stub.commitMatch({ reservationId: 'r1', matchId: 'm1', routeId: 'route-1', peerUid: 'peer-1' })
    // Re-commit with the same reservation id is idempotent, not an error.
    await expect(stub.commitMatch({ reservationId: 'r1', matchId: 'm1', routeId: 'route-1', peerUid: 'peer-1' })).resolves.toEqual({ ok: true })

    await runInDurableObject(stub, async (_instance, state) => {
      const seekRow = state.storage.sql.exec('SELECT * FROM seek WHERE one = 1').toArray()
      expect(seekRow.length).toBe(0)
      const event = state.storage.sql.exec("SELECT kind, body FROM events WHERE kind = 'match.commit'").toArray()[0]
      expect(JSON.parse(event.body)).toMatchObject({ matchId: 'm1', routeId: 'route-1' })
    })
  })

  it('releaseMatch returns a reservation to seeking without deleting the seek row', async () => {
    const stub = gateway('peerly:match-test-2')
    const now = Date.now()
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO seek (one, seek_id, state, expires_at) VALUES (1, 'seek-2', 'seeking', ?)", now + 60_000
      )
    })
    await stub.reserveForMatch({ reservationId: 'r3', queueKey: 'q1', seekId: 'seek-2', expiresAt: now + 30_000 })
    await stub.releaseMatch({ reservationId: 'r3' })
    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql.exec('SELECT state, reservation_id FROM seek WHERE one = 1').toArray()[0]
      expect(row.state).toBe('seeking')
      expect(row.reservation_id).toBeNull()
    })
  })

  it('alarm prunes expired sessions/nonces rows and releases an expired reservation', async () => {
    const stub = gateway('peerly:alarm-test-1')
    const now = Date.now()
    await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec(
        'INSERT INTO sessions (sid, dk, epoch, created_at, expires_at) VALUES (?, ?, 0, ?, ?)',
        'sid-stale', 'dk-a', now - 120_000, now - 119_000
      )
      state.storage.sql.exec('INSERT INTO nonces (hash, expires_at) VALUES (?, ?)', 'stale-nonce', now - 1000)
      state.storage.sql.exec(
        "INSERT INTO seek (one, seek_id, state, reservation_id, expires_at) VALUES (1, 'seek-3', 'reserved', 'r-stale', ?)",
        now - 1000
      )
      await instance.alarm()
      expect(state.storage.sql.exec('SELECT * FROM sessions').toArray().length).toBe(0)
      expect(state.storage.sql.exec('SELECT * FROM nonces').toArray().length).toBe(0)
      const seekRow = state.storage.sql.exec('SELECT state, reservation_id FROM seek WHERE one = 1').toArray()[0]
      expect(seekRow.state).toBe('seeking')
      expect(seekRow.reservation_id).toBeNull()
    })
  })
})

describe('UserGatewayDO fetch upgrade', () => {
  it('rejects an upgrade without trusted headers', async () => {
    const stub = gateway('peerly:fetch-test-1')
    const response = await stub.fetch('http://do/', { headers: { upgrade: 'websocket' } })
    expect(response.status).toBe(401)
  })

  it('rejects an upgrade with a session row for a different device key', async () => {
    const stub = gateway('peerly:fetch-test-2')
    const now = Date.now()
    const { sid } = await stub.registerSession({ dk: 'dk-real', now, ttlMs: 60_000 })
    const response = await stub.fetch('http://do/', {
      headers: { upgrade: 'websocket', 'x-realtime-uid': 'fetch-test-2', 'x-realtime-dk': 'dk-fake', 'x-realtime-sid': sid },
    })
    expect(response.status).toBe(401)
  })

  it('accepts a valid upgrade and completes a hello/ack round trip', async () => {
    const stub = gateway('peerly:fetch-test-3')
    const now = Date.now()
    const { sid } = await stub.registerSession({ dk: 'dk-real', now, ttlMs: 60_000 })
    const response = await stub.fetch('http://do/', {
      headers: { upgrade: 'websocket', 'x-realtime-uid': 'fetch-test-3', 'x-realtime-dk': 'dk-real', 'x-realtime-sid': sid },
    })
    expect(response.status).toBe(101)
    const ws = response.webSocket
    expect(ws).toBeTruthy()
    ws.accept()
    const ack = await new Promise(resolve => {
      ws.addEventListener('message', event => resolve(JSON.parse(event.data)), { once: true })
      ws.send(JSON.stringify({ v: 1, id: 'hello-1', type: 'hello', sentAt: Date.now(), payload: { version: 1 } }))
    })
    expect(ack.type).toBe('ack')
    expect(ack.payload.for).toBe('hello-1')
    ws.close()
  })

  it('closes 4002 on a hello carrying an unsupported protocol version', async () => {
    const stub = gateway('peerly:fetch-test-4')
    const now = Date.now()
    const { sid } = await stub.registerSession({ dk: 'dk-real', now, ttlMs: 60_000 })
    const response = await stub.fetch('http://do/', {
      headers: { upgrade: 'websocket', 'x-realtime-uid': 'fetch-test-4', 'x-realtime-dk': 'dk-real', 'x-realtime-sid': sid },
    })
    const ws = response.webSocket
    ws.accept()
    const closeEvent = await new Promise(resolve => {
      ws.addEventListener('close', resolve, { once: true })
      ws.send(JSON.stringify({ v: 1, id: 'hello-2', type: 'hello', sentAt: Date.now(), payload: { version: 2 } }))
    })
    expect(closeEvent.code).toBe(CLOSE.VERSION_UNSUPPORTED)
  })

  it('rejects any command sent before hello with malformed-frame, without version-negotiating it', async () => {
    const stub = gateway('peerly:fetch-test-5')
    const now = Date.now()
    const { sid } = await stub.registerSession({ dk: 'dk-real', now, ttlMs: 60_000 })
    const response = await stub.fetch('http://do/', {
      headers: { upgrade: 'websocket', 'x-realtime-uid': 'fetch-test-5', 'x-realtime-dk': 'dk-real', 'x-realtime-sid': sid },
    })
    const ws = response.webSocket
    ws.accept()
    const closeEvent = await new Promise(resolve => {
      ws.addEventListener('close', resolve, { once: true })
      ws.send(JSON.stringify({ v: 1, id: 'seek-1', type: 'seek.cancel', sentAt: Date.now(), payload: { seekId: 's1' } }))
    })
    expect(closeEvent.code).toBe(CLOSE.MALFORMED_FRAME)
  })
})
