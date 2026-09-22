// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveChannelCapability } from '../channelCapability'
import { joinDurableObjectsRoom } from './signaling'

const transport = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  requestScope: vi.fn(async () => ({ routeId: 'scope-route' })),
}))
vi.mock('./runtime.js', () => ({ getDurableObjectsTransport: () => transport }))
vi.mock('@trystero-p2p/core', () => ({ createTopicStrategy: (options: unknown) => options }))
afterEach(() => vi.unstubAllGlobals())

describe('Durable Objects signaling authorization', () => {
  it('never exposes the WebRTC or content encryption secret to scope.request', async () => {
    class Socket extends EventTarget {
      constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))) }
    }
    vi.stubGlobal('WebSocket', Socket)
    const secret = 'high-entropy-root-secret'
    const strategy = joinDurableObjectsRoom as unknown as { init(config: unknown): Promise<unknown> }
    await strategy.init({ durableObjects: { app: 'peerly', kind: 'workspace', capability: secret } })
    expect(transport.requestScope).toHaveBeenCalledWith('workspace',
      await deriveChannelCapability(secret, 'signal:workspace'))
    expect(JSON.stringify(transport.requestScope.mock.calls)).not.toContain(secret)
  })
})
