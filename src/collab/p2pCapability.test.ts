import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeP2pCapability } from './p2pCapability'

describe('probeP2pCapability', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports a browser without WebRTC as unavailable', async () => {
    vi.stubGlobal('RTCPeerConnection', undefined)
    await expect(probeP2pCapability()).resolves.toMatchObject({
      status: 'unavailable',
      detail: expect.stringContaining('does not expose WebRTC'),
    })
  })

  it('turns browser policy/constructor failures into a useful result', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        constructor() {
          throw new Error('Disabled by administrator')
        }
      }
    )
    await expect(probeP2pCapability()).resolves.toMatchObject({
      status: 'unavailable',
      detail: expect.stringContaining('Disabled by administrator'),
    })
  })
})
