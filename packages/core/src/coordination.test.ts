import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  coordinationScope,
  createRelayCoordinator,
  openCoordinationData,
  sealCoordinationData,
} from './coordination.js'

class FakeSocket extends EventTarget {
  readyState = 1
  sent: string[] = []
  send(value: string) {
    this.sent.push(value)
  }
}

afterEach(() => vi.unstubAllGlobals())

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
