import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeP2pCapability } from './p2pCapability'

describe('probeP2pCapability', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('queues Safari-style candidates emitted before the remote description', async () => {
    const peers: MockPeerConnection[] = []

    class MockPeerConnection {
      readonly id = peers.length
      onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null
      remoteDescription: RTCSessionDescription | null = null
      localDescription: RTCSessionDescription | null = null
      channel: { onopen: (() => void) | null; onerror: (() => void) | null } | null = null
      addedCandidates = 0

      constructor() {
        peers.push(this)
      }

      createDataChannel() {
        this.channel = { onopen: null, onerror: null }
        return this.channel
      }

      async createOffer() {
        return { type: 'offer' as const, sdp: 'offer' }
      }

      async createAnswer() {
        return { type: 'answer' as const, sdp: 'answer' }
      }

      async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description as RTCSessionDescription
        // Model Safari's ordering: the candidate arrives synchronously, before
        // probeP2pCapability has installed the other peer's remote description.
        this.onicecandidate?.({ candidate: { candidate: `candidate-${this.id}` } as RTCIceCandidate })
      }

      async setRemoteDescription(description: RTCSessionDescriptionInit) {
        this.remoteDescription = description as RTCSessionDescription
        if (this.id === 0 && description.type === 'answer') {
          queueMicrotask(() => this.channel?.onopen?.())
        }
      }

      async addIceCandidate() {
        if (!this.remoteDescription) throw new Error('Remote description was not set')
        this.addedCandidates += 1
      }

      close() {}
    }

    vi.stubGlobal('RTCPeerConnection', MockPeerConnection)

    await expect(probeP2pCapability(100)).resolves.toMatchObject({ status: 'available' })
    expect(peers).toHaveLength(2)
    expect(peers[0].addedCandidates).toBe(1)
    expect(peers[1].addedCandidates).toBe(1)
  })
})
