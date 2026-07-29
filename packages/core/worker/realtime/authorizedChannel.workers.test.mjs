import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'

const encrypted = label => ({
  v: 1,
  iv: 'a'.repeat(16),
  ciphertext: btoa(label),
})
const identity = name => ({
  uid: `opaque-${name}`,
  publicUserId: `user-${name}`,
  deviceKeyId: `device-${name}`,
  principalId: `principal-${name}`,
})

const authority = (version = 1, members = ['alice', 'bob']) => ({
  version,
  fingerprint: `authority-${version}`,
  members: members.map(member => `principal-${member}`),
})

async function authorize(stub, user, policy = authority()) {
  return stub.authorize({
    ...user,
    expiresAt: Date.now() + 60_000,
    authority: policy,
  })
}

async function connect(stub, user) {
  const response = await stub.fetch('http://content/', {
    headers: {
      upgrade: 'websocket',
      'x-realtime-uid': user.uid,
      'x-realtime-user': user.publicUserId,
      'x-realtime-dk': user.deviceKeyId,
    },
  })
  expect(response.status).toBe(101)
  const frames = []
  response.webSocket.accept()
  response.webSocket.addEventListener('message', event => {
    frames.push(JSON.parse(String(event.data)))
  })
  await vi.waitFor(() =>
    expect(frames.some(frame => frame.type === 'snapshot')).toBe(true)
  )
  return { ws: response.webSocket, frames }
}

describe('AuthorizedChannelDO', () => {
  it('rejects a socket without a gateway-issued authorization', async () => {
    const stub = env.CONTENT_CHANNELS.getByName(
      `peerly:unauthorized-${crypto.randomUUID()}`
    )
    const alice = identity('alice')
    const response = await stub.fetch('http://content/', {
      headers: {
        upgrade: 'websocket',
        'x-realtime-uid': alice.uid,
        'x-realtime-user': alice.publicUserId,
        'x-realtime-dk': alice.deviceKeyId,
      },
    })
    expect(response.status).toBe(401)
  })

  it('persists encrypted events before fan-out, acknowledges, and replays', async () => {
    const stub = env.CONTENT_CHANNELS.getByName(
      `peerly:history-${crypto.randomUUID()}`
    )
    const aliceIdentity = identity('alice')
    const bobIdentity = identity('bob')
    expect(await authorize(stub, aliceIdentity)).toEqual({ ok: true })
    expect(await authorize(stub, bobIdentity)).toEqual({ ok: true })
    const alice = await connect(stub, aliceIdentity)
    const bob = await connect(stub, bobIdentity)
    const messageId = crypto.randomUUID()
    const data = encrypted('signed-message')
    alice.ws.send(JSON.stringify({
      type: 'event',
      event: 'chat',
      messageId,
      data,
    }))

    await vi.waitFor(() => {
      expect(
        alice.frames.some(
          frame => frame.type === 'ack' && frame.messageId === messageId
        )
      ).toBe(true)
      expect(
        bob.frames.some(
          frame =>
            frame.type === 'event' &&
            frame.data?.ciphertext === data.ciphertext
        )
      ).toBe(true)
    })

    const lateBob = await connect(stub, bobIdentity)
    const snapshot = lateBob.frames.find(frame => frame.type === 'snapshot')
    expect(snapshot.events).toContainEqual(expect.objectContaining({
      event: 'chat',
      data,
      senderUserId: aliceIdentity.publicUserId,
      senderDeviceKeyId: aliceIdentity.deviceKeyId,
    }))
  })

  it('deduplicates a retried persisted frame and still acknowledges it', async () => {
    const stub = env.CONTENT_CHANNELS.getByName(
      `peerly:dedupe-${crypto.randomUUID()}`
    )
    const aliceIdentity = identity('alice')
    const bobIdentity = identity('bob')
    await authorize(stub, aliceIdentity)
    await authorize(stub, bobIdentity)
    const alice = await connect(stub, aliceIdentity)
    const bob = await connect(stub, bobIdentity)
    const frame = {
      type: 'event',
      event: 'chat',
      messageId: crypto.randomUUID(),
      data: encrypted('only-once'),
    }
    alice.ws.send(JSON.stringify(frame))
    alice.ws.send(JSON.stringify(frame))
    await vi.waitFor(() =>
      expect(
        alice.frames.filter(
          item => item.type === 'ack' && item.messageId === frame.messageId
        ).length
      ).toBeGreaterThanOrEqual(2)
    )
    expect(
      bob.frames.filter(
        item =>
          item.type === 'event' &&
          item.data?.ciphertext === frame.data.ciphertext
      )
    ).toHaveLength(1)
  })

  it('rejects plaintext content at the storage boundary', async () => {
    const stub = env.CONTENT_CHANNELS.getByName(
      `peerly:plaintext-${crypto.randomUUID()}`
    )
    const aliceIdentity = identity('alice')
    const bobIdentity = identity('bob')
    await authorize(stub, aliceIdentity)
    await authorize(stub, bobIdentity)
    const alice = await connect(stub, aliceIdentity)
    const bob = await connect(stub, bobIdentity)
    alice.ws.send(JSON.stringify({
      type: 'event',
      event: 'chat',
      messageId: crypto.randomUUID(),
      data: { text: 'server-readable' },
    }))
    await scheduler.wait(100)
    expect(bob.frames.filter(frame => frame.type === 'event')).toHaveLength(0)
  })

  it('applies only monotonic authority and closes revoked members', async () => {
    const stub = env.CONTENT_CHANNELS.getByName(
      `peerly:revoke-${crypto.randomUUID()}`
    )
    const aliceIdentity = identity('alice')
    const bobIdentity = identity('bob')
    await authorize(stub, aliceIdentity)
    await authorize(stub, bobIdentity)
    await connect(stub, aliceIdentity)
    const bob = await connect(stub, bobIdentity)
    let bobClosed = false
    bob.ws.addEventListener('close', () => {
      bobClosed = true
    })

    expect(
      await authorize(stub, aliceIdentity, authority(2, ['alice']))
    ).toEqual({ ok: true })
    await vi.waitFor(() => expect(bobClosed).toBe(true))
    expect(
      await authorize(stub, bobIdentity, authority(1))
    ).toEqual({ code: 'stale-authority' })
  })
})
