import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

/**
 * The rewritten gateway, exercised through the same surface the Worker routes
 * use. Its *rules* are covered without a runtime in
 * `src/adapters/durableObject/gatewayRuntime.test.ts`; what this file adds is
 * the wiring — schema creation, real WebSocket upgrades, hibernatable
 * attachments and RPC shapes — which only real workerd can prove.
 *
 * Bound as REWRITTEN_GATEWAYS alongside the current implementation so both
 * serve until this one has passed everything the old one does.
 */

const ACCOUNT = 'a'.repeat(43)
const DEVICE = `P-256:${'b'.repeat(43)}:${'c'.repeat(43)}`

function gateway(name) {
  return env.USER_GATEWAYS.getByName(`peerly:${name}`)
}

/** Opens an authenticated socket and completes the hello handshake. */
async function connect(stub, { uid = ACCOUNT, dk = DEVICE } = {}) {
  const { sid } = await stub.registerSession({ dk, now: Date.now(), ttlMs: 60_000, uid })
  const response = await stub.fetch('http://do/', {
    headers: { upgrade: 'websocket', 'x-realtime-uid': uid, 'x-realtime-dk': dk, 'x-realtime-sid': sid },
  })
  expect(response.status).toBe(101)
  const ws = response.webSocket
  const frames = []
  ws.accept()
  ws.addEventListener('message', event => frames.push(JSON.parse(String(event.data))))
  const closed = []
  ws.addEventListener('close', event => closed.push(event))
  await send(ws, frames, 'hello', { version: 1 })
  return { ws, frames, closed, sid }
}

/** Deltas are coalesced for `batchWindowMs` before they go out, so a frame
 *  cannot be read straight off the array the way an ack can. */
function waitForFrame(frames, match) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no matching frame')), 5_000)
    const poll = setInterval(() => {
      const frame = frames.find(match)
      if (!frame) return
      clearInterval(poll)
      clearTimeout(timer)
      resolve(frame)
    }, 5)
  })
}

function send(ws, frames, type, payload, id = crypto.randomUUID()) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer for ${type}`)), 5_000)
    const poll = setInterval(() => {
      const answer = frames.find(frame => frame.payload?.for === id)
      if (!answer) return
      clearInterval(poll)
      clearTimeout(timer)
      resolve(answer)
    }, 5)
    ws.send(JSON.stringify({ v: 1, id, type, sentAt: Date.now(), payload }))
  })
}

describe('UserGatewayDO', () => {
  it('creates its schema and issues a session', async () => {
    const stub = gateway('rw-session')
    const result = await stub.registerSession({ dk: DEVICE, now: Date.now(), ttlMs: 60_000, uid: ACCOUNT })
    expect(result.sid).toBeTruthy()
    expect((await stub.validateSession({ sid: result.sid, dk: DEVICE, epoch: result.epoch })).ok).toBe(true)
  })

  it('rejects an upgrade with no matching session', async () => {
    const response = await gateway('rw-noauth').fetch('http://do/', {
      headers: {
        upgrade: 'websocket', 'x-realtime-uid': ACCOUNT,
        'x-realtime-dk': DEVICE, 'x-realtime-sid': 'nope',
      },
    })
    expect(response.status).toBe(401)
  })

  it('remembers the account from the upgrade, never from its own id', async () => {
    // ctx.id.name is undefined inside a Durable Object; deriving identity from
    // it gave every account the same empty id.
    const stub = gateway('rw-identity')
    await connect(stub)
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql.exec("SELECT value FROM meta WHERE key = 'uid'").toArray()[0]
      expect(row.value).toBe(ACCOUNT)
    })
  })

  it('completes a hello handshake and survives an attachment round trip', async () => {
    const stub = gateway('rw-hello')
    const { ws, frames } = await connect(stub)
    expect(frames[0].type).toBe('ack')
    // A second command proves `negotiated` came back off the attachment rather
    // than in-memory state, which hibernation is free to evict.
    const answer = await send(ws, frames, 'invite.ack', { inviteId: 'nothing' })
    expect(answer.type).toBe('ack')
  })

  it('closes 4002 when the client speaks a version it does not support', async () => {
    const stub = gateway('rw-version')
    const { sid } = await stub.registerSession({ dk: DEVICE, now: Date.now(), ttlMs: 60_000, uid: ACCOUNT })
    const response = await stub.fetch('http://do/', {
      headers: { upgrade: 'websocket', 'x-realtime-uid': ACCOUNT, 'x-realtime-dk': DEVICE, 'x-realtime-sid': sid },
    })
    const ws = response.webSocket
    ws.accept()
    const closed = await new Promise(resolve => {
      ws.addEventListener('close', resolve, { once: true })
      ws.send(JSON.stringify({ v: 1, id: 'h1', type: 'hello', sentAt: Date.now(), payload: { version: 99 } }))
    })
    expect(closed.code).toBe(4002)
  })

  it('replays a repeated command answer instead of running it twice', async () => {
    const stub = gateway('rw-idem')
    const { ws, frames } = await connect(stub)
    const id = 'repeat-me'
    await send(ws, frames, 'invite.ack', { inviteId: 'i1' }, id)
    await send(ws, frames, 'invite.ack', { inviteId: 'i1' }, id)
    await runInDurableObject(stub, (_instance, state) => {
      const rows = state.storage.sql.exec('SELECT cmd_id FROM idempotency').toArray()
      expect(rows.filter(row => row.cmd_id === id)).toHaveLength(1)
    })
  })

  it('pushes delivered events to every open socket', async () => {
    const stub = gateway('rw-deliver')
    const { frames } = await connect(stub)
    await stub.deliver({ uid: ACCOUNT, events: [{ kind: 'ring', body: { from: 'someone' } }] })
    const delta = await waitForFrame(frames, frame => frame.type === 'delta')
    expect(delta.payload.events[0].kind).toBe('ring')
  })

  it('stores a mailbox copy and drops it on invite.ack', async () => {
    const stub = gateway('rw-mailbox')
    const { ws, frames } = await connect(stub)
    await stub.deliver({ uid: ACCOUNT, mailbox: { inviteId: 'i-42', body: '{}' }, events: [] })
    await runInDurableObject(stub, (_instance, state) => {
      expect(state.storage.sql.exec('SELECT * FROM mailbox').toArray()).toHaveLength(1)
    })
    await send(ws, frames, 'invite.ack', { inviteId: 'i-42' })
    await runInDurableObject(stub, (_instance, state) => {
      expect(state.storage.sql.exec('SELECT * FROM mailbox').toArray()).toHaveLength(0)
    })
  })

  it('rejects a replayed nonce', async () => {
    const stub = gateway('rw-nonce')
    const expiresAt = Date.now() + 60_000
    expect(await stub.consumeNonce('hash-1', expiresAt, ACCOUNT)).toBe(true)
    expect(await stub.consumeNonce('hash-1', expiresAt, ACCOUNT)).toBe(false)
  })

  it('revokes a device: epoch bumped, session gone, siblings told', async () => {
    const stub = gateway('rw-revoke')
    const other = `P-256:${'d'.repeat(43)}:${'e'.repeat(43)}`
    const victim = await stub.registerSession({ dk: other, now: Date.now(), ttlMs: 60_000, uid: ACCOUNT })
    const { ws, frames } = await connect(stub)

    const answer = await send(ws, frames, 'device.revoke', { deviceKeyId: other })
    expect(answer.type).toBe('ack')
    expect((await stub.validateSession({ sid: victim.sid, dk: other, epoch: victim.epoch })).ok).toBe(false)
    const delta = frames.find(frame => frame.type === 'delta')
    expect(delta.payload.events[0].kind).toBe('device.revoked')
  })

  it('answers a bad payload without dropping the connection', async () => {
    const stub = gateway('rw-badpayload')
    const { ws, frames } = await connect(stub)
    const answer = await send(ws, frames, 'invite.ack', { inviteId: 42 })
    expect(answer.payload.code).toBe('invalid-frame')
    const still = await send(ws, frames, 'invite.ack', { inviteId: 'ok' })
    expect(still.type).toBe('ack')
  })

  it('prunes expired state on its alarm', async () => {
    const stub = gateway('rw-alarm')
    await stub.consumeNonce('stale', Date.now() - 1, ACCOUNT)
    await runInDurableObject(stub, async instance => {
      await instance.alarm()
    })
    await runInDurableObject(stub, (_instance, state) => {
      expect(state.storage.sql.exec('SELECT * FROM nonces').toArray()).toHaveLength(0)
    })
  })
})
