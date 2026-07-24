import { getRuntimeAuthCredential } from '../runtimeCredentials.js'
import { RealtimeClient } from './client.js'
import { selectDurableObjectsTransport, type CoordinationTransport } from './transport.js'
import { FALLBACK_STUN_URL, type TurnServer } from '../relays.js'
import { requireAppId, type Env } from '../env.js'
import { resolveSignalingStrategy } from '../signaling.js'

const transports = new Map<string, CoordinationTransport>()
const turnServers = new Map<string, TurnServer[]>()
/** Resolves on the first `turn` event per app, so a join that starts while the
 *  control session is still being established still gets TURN instead of
 *  silently falling back to Trystero's STUN-only defaults. */
const turnArrivals = new Map<string, { promise: Promise<void>; resolve: () => void }>()
const TURN_WAIT_MS = 10_000

function turnArrival(app: string) {
  const existing = turnArrivals.get(app)
  if (existing) return existing
  let resolve = (): void => {}
  const promise = new Promise<void>(settle => { resolve = settle })
  const entry = { promise, resolve }
  turnArrivals.set(app, entry)
  return entry
}

/**
 * One control socket per app/tab. Room joins share it so several active P2P
 * scopes never consume the per-account control-socket allowance.
 */
export function getDurableObjectsTransport(app: string): CoordinationTransport {
  const existing = transports.get(app)
  if (existing) return existing
  const transport = selectDurableObjectsTransport('durable-objects', {
    app,
    credentialProvider: getRuntimeAuthCredential,
  })
  if (!transport) throw new Error('Durable Objects transport is unavailable')
  transport.events.addEventListener('turn', event => {
    const value = (event as CustomEvent<{
      urls?: unknown
      username?: unknown
      credential?: unknown
    }>).detail
    if (!value || (!Array.isArray(value.urls) && typeof value.urls !== 'string')) return
    const urls = Array.isArray(value.urls)
      ? value.urls.filter((url): url is string => typeof url === 'string')
      : [value.urls]
    if (urls.length === 0) return
    // Mirror the legacy /api/network/credentials shape exactly: one public
    // STUN entry alongside our own TURN, and the TURN URLs *exactly as the
    // deployment configured them*.
    //
    // Do not expand them into a transport ladder here. `expandTurnUrls`
    // rewrites `turns:<host>:5349` to `turns:<host>:443`, which only works
    // where nginx SNI-routes 443 to coturn — that is configured for
    // turn.peerly.cc and not for every TURN hostname (see
    // docs/turn-relay-vps.md). Expanding therefore *replaced* a working TLS
    // endpoint with one that may terminate somewhere else entirely. The
    // legacy path this backend has to match sends TURN_URLS unexpanded; when
    // chasing a connection regression, differing from the known-good path is
    // the last thing you want to do.
    turnServers.set(app, [
      { urls: [FALLBACK_STUN_URL] },
      {
        urls,
        ...(typeof value.username === 'string' ? { username: value.username } : {}),
        ...(typeof value.credential === 'string' ? { credential: value.credential } : {}),
      },
    ])
    turnArrival(app).resolve()
  })
  transports.set(app, transport)
  return transport
}

export async function getDurableObjectsIceServers(app: string): Promise<TurnServer[] | undefined> {
  const transport = getDurableObjectsTransport(app)
  const arrival = turnArrival(app)
  await transport.connect()
  // `connect()` resolves even when the cycle failed and only scheduled a
  // retry, so the credentials may legitimately not have landed yet. Wait a
  // bounded moment for them rather than reporting "no TURN configured".
  if (!turnServers.has(app)) {
    await Promise.race([
      arrival.promise,
      new Promise<void>(resolve => setTimeout(resolve, TURN_WAIT_MS)),
    ])
  }
  return turnServers.get(app)
}

/**
 * Revoke one of this account's own devices on the control plane: its server
 * sessions are deleted, its device epoch is bumped so any capability it still
 * holds stops validating, and its control sockets are closed.
 *
 * A no-op on the legacy backend, which has no server-side device registry —
 * so callers can wire this to "revoke" unconditionally. Rejects if the control
 * plane could not be reached, because a revocation that silently did nothing
 * is worse than one that reports failure.
 */
export async function revokeRealtimeDevice(env: Env, deviceKeyId: string): Promise<void> {
  if (resolveSignalingStrategy(env) !== 'durable-objects') return
  await getDurableObjectsTransport(requireAppId(env)).revokeDevice(deviceKeyId)
}

export function closeDurableObjectsTransport(app?: string): void {
  if (app) {
    transports.get(app)?.close()
    transports.delete(app)
    turnServers.delete(app)
    turnArrivals.delete(app)
    return
  }
  for (const transport of transports.values()) transport.close()
  transports.clear()
  turnServers.clear()
  turnArrivals.clear()
}

export { RealtimeClient }
