/**
 * Browser implementations of the control client's ports.
 *
 * Everything that touches `fetch`, `WebSocket`, `location` or IndexedDB lives
 * here and nowhere else, which is what leaves the state machine in
 * `app/realtimeClient.ts` testable without a browser.
 */
import { createKvStore } from '../../kvStore.js'
import type {
  ChannelEvents, ChannelFactory, ControlChannel, EnrollResult,
  KeyValueStore, SessionApi, SessionResult, Timers,
} from '../../ports/client.js'
import type { DeviceSignerLike, OidcCredentialProvider } from '../../realtime/types.js'

const encodeProof = (
  purpose: string, app: string, deviceKeyId: string, timestamp: number, nonce: string
) => new TextEncoder().encode([purpose, app, deviceKeyId, String(timestamp), nonce, ''].join('\n'))

async function proofHeaders(
  signer: DeviceSignerLike, purpose: string, app: string
): Promise<Record<string, string>> {
  const deviceKeyId = await signer.publicKeyId()
  const timestamp = Date.now()
  const nonce = crypto.randomUUID()
  return {
    'x-peerly-device-key': deviceKeyId,
    'x-peerly-request-ts': String(timestamp),
    'x-peerly-request-nonce': nonce,
    'x-peerly-request-signature': await signer.sign(
      encodeProof(purpose, app, deviceKeyId, timestamp, nonce)
    ),
  }
}

export type BrowserSessionOptions = {
  readonly app: string
  readonly credentials: OidcCredentialProvider
  readonly fetchImpl?: typeof fetch
}

/**
 * `/api/network/enroll` and `/api/network/session`.
 *
 * Each HTTP outcome is mapped to a named result rather than an exception, so
 * the state machine can distinguish "this capability is dead, discard it" from
 * "the network is down, retry" — a distinction the previous client lost, which
 * is how a rejected capability got resent forever.
 */
export function createBrowserSessionApi(options: BrowserSessionOptions): SessionApi {
  const request = options.fetchImpl ?? fetch

  return {
    async enroll(): Promise<EnrollResult> {
      const auth = await options.credentials()
      if (!auth) return { kind: 'failed' }
      const response = await request('/api/network/enroll', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(await proofHeaders(auth.signer, 'realtime-enroll-v1', options.app)),
        },
        body: JSON.stringify({ provider: auth.providerId, token: auth.token }),
      })
      if (response.status === 409) return { kind: 'conflict' }
      if (!response.ok) return { kind: 'failed' }
      const body = await response.json() as { capability?: unknown }
      return typeof body.capability === 'string'
        ? { kind: 'capability', capability: body.capability }
        : { kind: 'failed' }
    },

    async establish(capability: string): Promise<SessionResult> {
      const auth = await options.credentials()
      if (!auth) return { kind: 'failed' }
      const response = await request('/api/network/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(await proofHeaders(auth.signer, 'realtime-session-v1', options.app)),
        },
        body: JSON.stringify({ capability }),
      })
      // 401 means this capability will never work again; anything else that
      // failed is worth retrying with the same one.
      if (response.status === 401) return { kind: 'rejected' }
      if (!response.ok) return { kind: 'failed' }
      const body = await response.json() as { turn?: unknown }
      return { kind: 'established', turn: body.turn }
    },
  }
}

/** A WebSocket to a same-origin path, upgraded to wss on https. */
export function createBrowserChannelFactory(path: string): ChannelFactory {
  return {
    connect(events: ChannelEvents): ControlChannel {
      const url = new URL(path, location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url.toString())
      socket.addEventListener('open', () => events.onOpen())
      socket.addEventListener('message', event => events.onFrame(String(event.data)))
      socket.addEventListener('close', event => events.onClose(event.code))
      socket.addEventListener('error', () => events.onError())
      return {
        send: frame => socket.send(frame),
        close: () => socket.close(1000, 'client closing'),
        get open() { return socket.readyState === WebSocket.OPEN },
      }
    },
  }
}

/** App-scoped so two products in one browser never share stored state. */
export function createBrowserStore(app: string): KeyValueStore {
  const kv = createKvStore<string | number>(`${app}-realtime`, 'state')
  return {
    // The underlying store reports a miss as null; the port speaks undefined
    // so an absent value and a stored null cannot be confused.
    get: async key => (await kv.get(key)) ?? undefined,
    set: (key, value) => kv.set(key, value),
  }
}

export const browserTimers: Timers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
  clearTimeout: handle => globalThis.clearTimeout(handle),
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms) as unknown as number,
  clearInterval: handle => globalThis.clearInterval(handle),
}
