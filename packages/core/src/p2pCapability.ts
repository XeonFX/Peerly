export type P2pCapability = {
  status: 'checking' | 'available' | 'unavailable'
  detail: string
}

const PROBE_TIMEOUT_MS = 6_000

/**
 * Exercise a real WebRTC data channel entirely inside this browser.
 *
 * This catches browsers where WebRTC is missing or disabled by policy. It does
 * not pretend to prove internet NAT traversal: only a connection to another
 * device can do that, so the UI reports that separately.
 */
export async function probeP2pCapability(
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<P2pCapability> {
  if (typeof RTCPeerConnection === 'undefined') {
    return {
      status: 'unavailable',
      detail: 'This browser does not expose WebRTC peer connections.',
    }
  }

  let offerer: RTCPeerConnection | null = null
  let answerer: RTCPeerConnection | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    offerer = new RTCPeerConnection()
    answerer = new RTCPeerConnection()

    const left = offerer
    const right = answerer
    const pendingForLeft: RTCIceCandidate[] = []
    const pendingForRight: RTCIceCandidate[] = []
    const forwardCandidate = (
      target: RTCPeerConnection,
      pending: RTCIceCandidate[],
      candidate: RTCIceCandidate
    ) => {
      // Safari can emit host candidates synchronously from
      // setLocalDescription(). addIceCandidate() is invalid until the target
      // has a remote description, so retain those early candidates instead of
      // silently dropping the only viable path for this local self-test.
      if (!target.remoteDescription) {
        pending.push(candidate)
        return
      }
      void target.addIceCandidate(candidate).catch(() => {})
    }
    const flushCandidates = async (
      target: RTCPeerConnection,
      pending: RTCIceCandidate[]
    ) => {
      for (const candidate of pending.splice(0)) {
        await target.addIceCandidate(candidate)
      }
    }
    left.onicecandidate = event => {
      if (event.candidate) forwardCandidate(right, pendingForRight, event.candidate)
    }
    right.onicecandidate = event => {
      if (event.candidate) forwardCandidate(left, pendingForLeft, event.candidate)
    }

    const channel = left.createDataChannel('peerly-capability-check')
    const opened = new Promise<void>((resolve, reject) => {
      channel.onopen = () => resolve()
      channel.onerror = () => reject(new Error('The WebRTC data channel was rejected.'))
      timer = setTimeout(() => reject(new Error('The WebRTC self-test timed out.')), timeoutMs)
    })

    const offer = await left.createOffer()
    await left.setLocalDescription(offer)
    await right.setRemoteDescription(offer)
    await flushCandidates(right, pendingForRight)
    const answer = await right.createAnswer()
    await right.setLocalDescription(answer)
    await left.setRemoteDescription(answer)
    await flushCandidates(left, pendingForLeft)
    await opened

    return {
      status: 'available',
      detail: 'Browser WebRTC data channels are enabled. A real network path is confirmed when a teammate connects.',
    }
  } catch (error) {
    return {
      status: 'unavailable',
      detail:
        error instanceof Error
          ? `WebRTC self-test failed: ${error.message}`
          : 'WebRTC is disabled or blocked in this browser.',
    }
  } finally {
    if (timer) clearTimeout(timer)
    offerer?.close()
    answerer?.close()
  }
}
