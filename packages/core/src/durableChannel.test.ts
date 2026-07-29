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
    const sending = room.makeAction<{ text: string }>('chat').send(
      { text: 'hello' },
      { target: 'bob' }
    )
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: 'event',
      event: 'chat',
      data: { text: 'hello' },
      target: 'bob',
    })
    socket.receive({
      type: 'ack',
      messageId: JSON.parse(socket.sent[0]).messageId,
    })
    await sending
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
    const sending = room.makeAction<{ text: string }>('chat').send({
      text: 'private message',
    })
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
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
    socket.receive({ type: 'ack', messageId: outbound.messageId })
    await sending
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith(
      { text: 'private message' },
      { peerId: 'bob', userId: 'bob', deviceKeyId: 'dk-b' }
    ))
  })

  it('re-authorizes and replays the same unacknowledged frame after reconnecting', async () => {
    const sockets: FakeWebSocket[] = []
    const authorize = vi.fn(async () => ({ routeId: 'opaque-route' }))
    const opening = openDurableChannel({
      authorize,
      endpointPrefix: '/api/realtime/room/',
      webSocketFactory: () => {
        const candidate = new FakeWebSocket()
        sockets.push(candidate)
        return candidate as unknown as WebSocket
      },
    })

    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].receive({
      type: 'snapshot',
      connectionId: 'alice-first',
      members: [{ connectionId: 'alice-first', userId: 'alice', deviceKeyId: 'dk-a' }],
    })
    const room = await opening
    const sending = room.makeAction<{ text: string }>('chat').send({ text: 'retry me' })
    await vi.waitFor(() => expect(sockets[0].sent).toHaveLength(1))
    const original = sockets[0].sent[0]

    sockets[0].close()
    await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2_000 })
    expect(authorize).toHaveBeenCalledTimes(2)
    sockets[1].receive({
      type: 'snapshot',
      connectionId: 'alice-second',
      members: [{ connectionId: 'alice-second', userId: 'alice', deviceKeyId: 'dk-a' }],
    })
    await vi.waitFor(() => expect(sockets[1].sent).toEqual([original]))

    sockets[1].receive({
      type: 'ack',
      messageId: JSON.parse(original).messageId,
    })
    await sending
    room.leave()
  })
})
