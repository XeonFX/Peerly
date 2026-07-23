import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  coordinationScope,
  createRelayCoordinator,
  openCoordinationData,
  sealCoordinationData,
} from './coordination.js'
import {
  clearRuntimeNetworkCredentials,
  configureRuntimeAuthCredentialProvider,
} from './runtimeCredentials.js'

class FakeSocket extends EventTarget {
  readyState = 1
  sent: string[] = []
  send(value: string) {
    this.sent.push(value)
  }
}

class OwnedFakeSocket extends FakeSocket {
  readyState = 0
  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
}

afterEach(() => {
  configureRuntimeAuthCredentialProvider(null)
  clearRuntimeNetworkCredentials()
  vi.unstubAllGlobals()
})

describe('relay coordination client', () => {
  it('waits for relay capability acknowledgement before flushing state', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    const socket = new FakeSocket()
    const coordinator = createRelayCoordinator(
      { VITE_RELAY_PORT: '8080' },
      { getSockets: () => ({ 'ws://127.0.0.1:8080': socket as unknown as WebSocket }) }
    )
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      action: 'hello',
      capabilities: ['seek-ack'],
    })
    coordinator.setPresence('scope', 'member', 'ciphertext')
    expect(socket.sent).toHaveLength(1)

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ topic: '__relay_coord_v1__', payload: { v: 1, type: 'ready' } }),
    }))
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2))
    expect(JSON.parse(socket.sent[1])).toMatchObject({ action: 'presence.set', scope: 'scope' })
    coordinator.close()
  })

  it('acknowledges v2 proposals without storing them as desired state', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    const socket = new FakeSocket()
    const coordinator = createRelayCoordinator(
      { VITE_RELAY_PORT: '8080' },
      { getSockets: () => ({ 'ws://127.0.0.1:8080': socket as unknown as WebSocket }) }
    )
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ topic: '__relay_coord_v1__', payload: { v: 1, type: 'ready' } }),
    }))
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))

    coordinator.acknowledgeSeekMatch('random', 'match-1')
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      action: 'seek.ack', pool: 'random', matchId: 'match-1',
    })
    coordinator.close()
  })

  it('owns a dedicated coordination socket and refreshes desired state after it opens', async () => {
    vi.stubGlobal('WebSocket', { CONNECTING: 0, OPEN: 1, CLOSED: 3 })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      relayTickets: {
        'relay-a.example': 'ticket-a',
        'relay-b.example': 'ticket-b',
      },
      expiresAt: Date.now() + 5 * 60_000,
    })))
    configureRuntimeAuthCredentialProvider(() => ({
      token: 'signed-id-token',
      providerId: 'google',
      signer: {
        publicKeyId: async () => `P-256:${'a'.repeat(22)}:${'b'.repeat(22)}`,
        sign: async () => 'device-signature',
      },
    }))
    const created: Array<{ url: string; socket: OwnedFakeSocket }> = []
    const coordinator = createRelayCoordinator(
      { VITE_RELAY_HOSTS: 'relay-a.example,relay-b.example', VITE_RELAY_PORT: '443' },
      {
        createSocket: url => {
          const socket = new OwnedFakeSocket()
          created.push({ url, socket })
          return socket as unknown as WebSocket
        },
        reconnectMs: 1,
      }
    )
    coordinator.setPresence('scope', 'member', 'ciphertext')

    await vi.waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].url).toBe('wss://relay-a.example:443?ticket=ticket-a')
    created[0].socket.open()
    expect(JSON.parse(created[0].socket.sent[0])).toMatchObject({ action: 'hello' })
    created[0].socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ topic: '__relay_coord_v1__', payload: { v: 1, type: 'ready' } }),
    }))
    await vi.waitFor(() => expect(created[0].socket.sent).toHaveLength(2))
    expect(JSON.parse(created[0].socket.sent[1])).toMatchObject({ action: 'presence.set' })

    created[0].socket.close()
    await vi.waitFor(() => expect(created).toHaveLength(2))
    expect(created[1].url).toBe('wss://relay-b.example:443?ticket=ticket-b')
    coordinator.close()
  })

  it('encrypts workspace metadata and rejects the wrong secret', async () => {
    const firstScope = await coordinationScope('workspace:a', 'secret')
    const secondScope = await coordinationScope('workspace:a', 'secret')
    expect(firstScope).toBe(secondScope)
    expect(firstScope).not.toContain('secret')

    const wire = await sealCoordinationData('secret', 'presence', { name: 'Alice' })
    await expect(openCoordinationData('secret', 'presence', wire)).resolves.toEqual({ name: 'Alice' })
    await expect(openCoordinationData('wrong', 'presence', wire)).resolves.toBeNull()
  })
})
