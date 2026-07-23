import type { Env } from './env.js'
import { getTurnConfig, resolveIceServers, type TurnServer } from './relays.js'

export type TurnCapability = {
  status: 'not-configured' | 'checking' | 'available' | 'unavailable'
  detail: string
  transports: string[]
}

const TURN_PROBE_TIMEOUT_MS = 12_000

/**
 * Force ICE gathering through TURN only. A relay candidate proves DNS, TLS or
 * transport reachability, authentication, and allocation from this browser's
 * current network without needing another user to be online.
 */
export async function probeTurnCapability(
  env: Env,
  timeoutMs: number = TURN_PROBE_TIMEOUT_MS,
  resolveCredentials: (env: Env) => Promise<TurnServer[] | undefined> = resolveIceServers
): Promise<TurnCapability> {
  if (!getTurnConfig(env)) {
    return { status: 'not-configured', detail: 'TURN is not configured.', transports: [] }
  }
  if (typeof RTCPeerConnection === 'undefined') {
    return { status: 'unavailable', detail: 'This browser does not expose WebRTC peer connections.', transports: [] }
  }

  let connection: RTCPeerConnection | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const iceServers = await resolveCredentials(env)
    if (!iceServers?.length) throw new Error('TURN credentials are unavailable. Sign in again and retry.')
    connection = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' })
    connection.createDataChannel('peerly-turn-check')
    const transports = new Set<string>()
    const candidateErrors = new Set<string>()
    const gathered = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('TURN allocation timed out.')), timeoutMs)
      connection!.onicecandidate = event => {
        if (event.candidate) {
          if (event.candidate.type === 'relay') {
            transports.add(event.candidate.protocol || 'unknown')
            // A relay candidate already proves reachability, authentication,
            // and allocation. Do not wait for every fallback transport to
            // finish: a blocked UDP/TCP path may keep ICE gathering open past
            // the timeout and turn a successful allocation into a false red.
            resolve()
          }
          return
        }
        resolve()
      }
      connection!.onicecandidateerror = event => {
        // Keep gathering: one transport may fail while TLS/443 succeeds.
        // Browsers commonly report the failed UDP attempt even when the TCP or
        // TLS fallback succeeds, so avoid noisy console errors here.
        if (event.errorText) candidateErrors.add(event.errorText)
      }
    })
    await connection.setLocalDescription(await connection.createOffer())
    await gathered
    if (transports.size === 0) {
      const detail = [...candidateErrors][0]
      throw new Error(detail || 'TURN responded without a relay candidate.')
    }
    return {
      status: 'available',
      detail: `TURN relay allocation succeeded (${[...transports].join(', ')}).`,
      transports: [...transports],
    }
  } catch (error) {
    return {
      status: 'unavailable',
      detail: error instanceof Error ? error.message : 'TURN allocation failed.',
      transports: [],
    }
  } finally {
    if (timer) clearTimeout(timer)
    connection?.close()
  }
}
