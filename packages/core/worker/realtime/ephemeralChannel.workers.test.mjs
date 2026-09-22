import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { channelIdentity as identity, channelSession } from './channel.test-fixtures.mjs'

async function connect(stub, user) {
  const session = await channelSession(user)
  const response = await stub.fetch('http://lobby/', {
    headers: {
      upgrade: 'websocket',
      'x-realtime-user': user.userId,
      'x-realtime-dk': user.deviceKeyId,
      'x-realtime-uid': user.uid,
      'x-realtime-sid': session.sid,
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

describe('LobbyChannelDO', () => {
  it('forwards only allowed events and acknowledges their sender', async () => {
    const stub = env.LOBBY_CHANNELS.getByName(
      `peerly:lobby-${crypto.randomUUID()}`
    )
    const alice = await connect(stub, identity('alice'))
    const bob = await connect(stub, identity('bob'))
    const messageId = crypto.randomUUID()
    alice.ws.send(JSON.stringify({
      type: 'event',
      event: 'finv',
      messageId,
      data: { signedInvite: 'opaque-to-channel' },
      target: 'user-bob',
    }))

    await vi.waitFor(() => {
      expect(alice.frames).toContainEqual({
        type: 'ack',
        messageId,
      })
      expect(bob.frames).toContainEqual(expect.objectContaining({
        type: 'event',
        event: 'finv',
        data: { signedInvite: 'opaque-to-channel' },
        senderUserId: 'user-alice',
        senderDeviceKeyId: identity('alice').deviceKeyId,
      }))
    })

    const invalidId = crypto.randomUUID()
    alice.ws.send(JSON.stringify({
      type: 'event',
      event: 'not-allowed',
      messageId: invalidId,
      data: {},
    }))
    await vi.waitFor(() =>
      expect(alice.frames).toContainEqual({
        type: 'error',
        messageId: invalidId,
        code: 'invalid-frame',
      })
    )
  })

  it('keeps no event history for a later connection', async () => {
    const stub = env.LOBBY_CHANNELS.getByName(
      `peerly:ephemeral-${crypto.randomUUID()}`
    )
    const alice = await connect(stub, identity('alice'))
    alice.ws.send(JSON.stringify({
      type: 'event',
      event: 'pres',
      messageId: crypto.randomUUID(),
      data: { now: true },
    }))
    const lateBob = await connect(stub, identity('bob'))
    const snapshot = lateBob.frames.find(frame => frame.type === 'snapshot')
    expect(snapshot).not.toHaveProperty('events')
  })
})
