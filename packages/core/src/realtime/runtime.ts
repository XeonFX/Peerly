import { getRuntimeAuthCredential } from '../runtimeCredentials.js'
import { RealtimeClient } from './client.js'
import { selectDurableObjectsTransport, type CoordinationTransport } from './transport.js'
import type { TurnServer } from '../relays.js'

const transports = new Map<string, CoordinationTransport>()
const turnServers = new Map<string, TurnServer[]>()

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
    turnServers.set(app, [{
      urls: Array.isArray(value.urls) ? value.urls.filter((url): url is string => typeof url === 'string') : [value.urls],
      ...(typeof value.username === 'string' ? { username: value.username } : {}),
      ...(typeof value.credential === 'string' ? { credential: value.credential } : {}),
    }])
  })
  transports.set(app, transport)
  return transport
}

export async function getDurableObjectsIceServers(app: string): Promise<TurnServer[] | undefined> {
  const transport = getDurableObjectsTransport(app)
  await transport.connect()
  return turnServers.get(app)
}

export function closeDurableObjectsTransport(app?: string): void {
  if (app) {
    transports.get(app)?.close()
    transports.delete(app)
    turnServers.delete(app)
    return
  }
  for (const transport of transports.values()) transport.close()
  transports.clear()
  turnServers.clear()
}

export { RealtimeClient }
