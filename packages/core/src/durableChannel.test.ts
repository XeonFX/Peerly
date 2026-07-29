// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { openDurableChannel } from './durableChannel.js'

class FakeWebSocket extends EventTarget {
  readyState = WebSocket.OPEN
  readonly sent: string[] = []

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.readyState = WebSocket.CLOSED
    this.dispatchEvent(new CloseEvent('close'))
  }

  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(value),
    }))
  }
}

async function openWithSnapshot(snapshot: object, encryptionSecret?: string) {
  let socket: FakeWebSocket | undefined
  const opening = openDurableChannel({
    authorize: async () => ({ routeId: 'opaque-route' }),
    endpointPrefix: '/api/realtime/room/',
    webSocketFactory: () => {
      socket = new FakeWebSocket()
      return socket as unknown as WebSocket
    },
    ...(encryptionSecret ? { encryptionSecret } : {}),
  })
  await vi.waitFor(() => expect(socket).toBeDefined())
  socket!.receive(snapshot)
  return { room: await opening, socket: socket! }
}

describe('openDurableChannel', () => {
  it('aggregates connections by user and excludes this account other tabs', async () => {
    const { room } = await openWithSnapshot({
      type: 'snapshot',
      connectionId: 'alice-tab-1',
      members: [
        { connectionId: 'alice-tab-1', userId: 'alice', deviceKeyId: 'dk-a1' },
        { connectionId: 'alice-tab-2', userId: 'alice', deviceKeyId: 'dk-a2' },
        { connectionId: 'bob-tab-1', userId: 'bob', deviceKeyId: 'dk-b1' },
        { connectionId: 'bob-tab-2', userId: 'bob', deviceKeyId: 'dk-b2' },
      ],
    })
    expect(Object.keys(room.getPeers())).toEqual(['bob'])
  })

  it('buffers persistent history until the consumer installs its action handler', async () => {
    const chat = { id: 'message-1', text: 'from history' }
    const { room } = await openWithSnapshot({
      type: 'snapshot',
      connectionId: 'alice-tab',
      members: [
        { connectionId: 'alice-tab', userId: 'alice', deviceKeyId: 'dk-a' },
      ],
      events: [{
        type: 'event',
        event: 'chat',
        data: chat,
        senderUserId: 'bob',
        senderDeviceKeyId: 'dk-b',
      }],
    })
    const received = vi.fn()
    room.makeAction('chat').onMessage = received
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith(chat, {
      peerId: 'bob',
      userId: 'bob',
      deviceKeyId: 'dk-b',
    }))
  })

  it('targets every connection belonging to a logical user id', async () => {
    const { room, socket } = await openWithSnapshot({
      type: 'snapshot',
      connectionId: 'alice-tab',
      members: [
        { connectionId: 'alice-tab', userId: 'alice', deviceKeyId: 'dk-a' },
        { connectionId: 'bob-tab', userId: 'bob', deviceKeyId: 'dk-b' },
      ],
    })
    await room.makeAction<{ text: string }>('chat').send(
      { text: 'hello' },
      { target: 'bob' }
    )
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: 'event',
      event: 'chat',
      data: { text: 'hello' },
      target: 'bob',
    })
  })

  it('encrypts room payloads before they reach the Durable Object', async () => {
    const { room, socket } = await openWithSnapshot({
      type: 'snapshot',
      connectionId: 'alice-tab',
      members: [
        { connectionId: 'alice-tab', userId: 'alice', deviceKeyId: 'dk-a' },
        { connectionId: 'bob-tab', userId: 'bob', deviceKeyId: 'dk-b' },
      ],
    }, 'high-entropy-room-capability')
    const received = vi.fn()
    room.makeAction<{ text: string }>('chat').onMessage = received
    await room.makeAction<{ text: string }>('chat').send({ text: 'private message' })
    const outbound = JSON.parse(socket.sent[0])
    expect(JSON.stringify(outbound.data)).not.toContain('private message')
    expect(outbound.data).toMatchObject({ v: 1 })

    socket.receive({
      type: 'event',
      event: 'chat',
      data: outbound.data,
      senderUserId: 'bob',
      senderDeviceKeyId: 'dk-b',
    })
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith(
      { text: 'private message' },
      { peerId: 'bob', userId: 'bob', deviceKeyId: 'dk-b' }
    ))
  })
})
