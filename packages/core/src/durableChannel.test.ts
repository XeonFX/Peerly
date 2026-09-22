// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { openDurableChannel } from './durableChannel.js'
import { deriveChannelCapability } from './channelCapability.js'

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
  it('keeps a caller message id and hides stable channel-state keys', async () => {
    const { room, socket } = await openWithSnapshot({ type: 'snapshot', connectionId: 'self', members: [] }, 'private-workspace-secret')
    const action = room.makeAction('channel-sync')
    for (let revision = 1; revision <= 2; revision++) {
      const sending = action.send({ name: 'private-channel-name', revision }, {
        messageId: `stable-${revision}`, state: { key: 'private-channel-id', revision, deleted: false },
      })
      await vi.waitFor(() => expect(socket.sent).toHaveLength(revision))
      const frame = JSON.parse(socket.sent[revision - 1])
      expect(frame.messageId).toBe(`stable-${revision}`)
      expect(frame.state.key).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(socket.sent[revision - 1]).not.toMatch(/private-workspace-secret|private-channel-name|private-channel-id/)
      if (revision === 2) expect(frame.state.key).toBe(JSON.parse(socket.sent[0]).state.key)
      socket.receive({ type: 'ack', messageId: frame.messageId })
      await sending
    }
    room.leave()
  })

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

    // Reproduce the old failure: the server sees every routing capability
    // and the ciphertext, but none of these must be usable as a content key.
    const root = 'high-entropy-room-capability'
    for (const purpose of ['workspace-content:creator', 'dm-content', 'signal:workspace', 'signal:room']) {
      const seenByServer = await deriveChannelCapability(root, purpose)
      const material = await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(`peerly-durable-channel-v1\n${seenByServer}`))
      const key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['decrypt'])
      const bytes = (value: string) => Uint8Array.from(
        atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
      await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(outbound.data.iv) },
        key, bytes(outbound.data.ciphertext))).rejects.toThrow()
    }


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
