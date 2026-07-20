import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeTurnCapability } from './turnCapability.js'

describe('probeTurnCapability', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not probe when TURN is absent', async () => {
    await expect(probeTurnCapability({})).resolves.toEqual({
      status: 'not-configured',
      detail: 'TURN is not configured.',
      transports: [],
    })
  })

  it('turns browser policy failures into an unavailable result', async () => {
    vi.stubGlobal('RTCPeerConnection', class {
      constructor() {
        throw new Error('TURN blocked by administrator')
      }
    })
    await expect(probeTurnCapability({ VITE_TURN_URLS: 'turn:turn.example:3478' })).resolves.toMatchObject({
      status: 'unavailable',
      detail: expect.stringContaining('blocked by administrator'),
    })
  })
})
