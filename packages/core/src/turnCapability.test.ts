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
    await expect(probeTurnCapability(
      { VITE_TURN_URLS: 'turn:turn.example:3478' },
      20,
      async () => [{ urls: ['turn:turn.example:3478'], username: 'user', credential: 'pass' }]
    )).resolves.toMatchObject({
      status: 'unavailable',
      detail: expect.stringContaining('blocked by administrator'),
    })
  })

  it('does not attempt anonymous TURN when runtime credentials are unavailable', async () => {
    const PeerConnection = vi.fn()
    vi.stubGlobal('RTCPeerConnection', PeerConnection)

    await expect(probeTurnCapability(
      { VITE_TURN_URLS: 'turn:turn.example:3478' },
      20,
      async () => undefined
    )).resolves.toMatchObject({
      status: 'unavailable',
      detail: expect.stringContaining('credentials are unavailable'),
    })
    expect(PeerConnection).not.toHaveBeenCalled()
  })

  it('succeeds on the first relay candidate without waiting for gathering to finish', async () => {
    class FakePeerConnection {
      onicecandidate: ((event: { candidate: { type: string; protocol: string } | null }) => void) | null = null
      onicecandidateerror: ((event: { errorText?: string }) => void) | null = null
      createDataChannel() {}
      async createOffer() { return {} }
      async setLocalDescription() {
        queueMicrotask(() => this.onicecandidate?.({ candidate: { type: 'relay', protocol: 'tcp' } }))
      }
      close() {}
    }
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)

    await expect(probeTurnCapability(
      { VITE_TURN_URLS: 'turn:turn.example:3478' },
      20,
      async () => [{
        urls: ['turn:turn.example:3478'],
        username: 'runtime-user',
        credential: 'runtime-credential',
      }]
    )).resolves.toEqual({
      status: 'available',
      detail: 'TURN relay allocation succeeded (tcp).',
      transports: ['tcp'],
    })
  })
})
