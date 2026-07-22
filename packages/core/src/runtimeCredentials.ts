import type { DeviceSigner } from './textChatSigning.js'
import type { TurnServer } from './relays.js'

export type RuntimeNetworkCredentials = {
  relayTicket?: string
  relayTickets?: Record<string, string>
  iceServers?: TurnServer[]
  rendezvousId?: string
  expiresAt: number
}

export type RuntimeAuthCredential = {
  token: string
  providerId: string
  signer: DeviceSigner
}

let authCredentialProvider: (() => RuntimeAuthCredential | null | Promise<RuntimeAuthCredential | null>) | null = null
let cached: RuntimeNetworkCredentials | null = null
let pending: Promise<RuntimeNetworkCredentials | null> | null = null
const rendezvousCache = new Map<string, string>()

/** Register the live, device-bound OIDC credential used to mint relay/TURN tickets. */
export function configureRuntimeAuthCredentialProvider(
  provider: (() => RuntimeAuthCredential | null | Promise<RuntimeAuthCredential | null>) | null
): void {
  authCredentialProvider = provider
  cached = null
  pending = null
  rendezvousCache.clear()
}

/**
 * Backward-compatible Google-only adapter. New consumers should provide the
 * signer too via `configureRuntimeAuthCredentialProvider`; without it the
 * credential endpoint will reject the request rather than mint an unbound
 * infrastructure ticket.
 */
export function configureRuntimeAuthTokenProvider(
  provider: (() => string | null | Promise<string | null>) | null
): void {
  configureRuntimeAuthCredentialProvider(provider ? async () => {
    const token = await provider()
    if (!token) return null
    return {
      token,
      providerId: 'google',
      signer: {
        publicKeyId: async () => '',
        sign: async () => '',
      },
    }
  } : null)
}

const encodeRequestProof = (
  providerId: string,
  deviceKeyId: string,
  timestamp: number,
  nonce: string
): Uint8Array => new TextEncoder().encode([
  'peerly-network-credentials-v1',
  providerId,
  deviceKeyId,
  String(timestamp),
  nonce,
].join('\n'))

export async function getRuntimeNetworkCredentials(): Promise<RuntimeNetworkCredentials | null> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached
  if (!authCredentialProvider || typeof fetch !== 'function') return null
  if (pending) return pending
  pending = (async () => {
    try {
      const auth = await authCredentialProvider?.()
      if (!auth?.token || !auth.providerId) return null
      const deviceKeyId = await auth.signer.publicKeyId()
      if (!deviceKeyId) return null
      const timestamp = Date.now()
      const nonce = crypto.randomUUID()
      const signature = await auth.signer.sign(
        encodeRequestProof(auth.providerId, deviceKeyId, timestamp, nonce)
      )
      if (!signature) return null
      const response = await fetch('/api/network/credentials', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${auth.token}`,
          'x-peerly-provider': auth.providerId,
          'x-peerly-device-key': deviceKeyId,
          'x-peerly-request-ts': String(timestamp),
          'x-peerly-request-nonce': nonce,
          'x-peerly-request-signature': signature,
        },
      })
      if (!response.ok) return null
      const value = await response.json() as Partial<RuntimeNetworkCredentials>
      if (typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()) return null
      const next: RuntimeNetworkCredentials = {
        expiresAt: value.expiresAt,
        ...(typeof value.relayTicket === 'string' ? { relayTicket: value.relayTicket } : {}),
        ...(value.relayTickets && typeof value.relayTickets === 'object'
          ? { relayTickets: Object.fromEntries(Object.entries(value.relayTickets)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }
          : {}),
        ...(Array.isArray(value.iceServers) ? { iceServers: value.iceServers } : {}),
        ...(typeof value.rendezvousId === 'string' ? { rendezvousId: value.rendezvousId } : {}),
      }
      cached = next
      return next
    } catch {
      return null
    } finally {
      pending = null
    }
  })()
  return pending
}

const rendezvousProof = (
  providerId: string,
  deviceKeyId: string,
  timestamp: number,
  nonce: string,
  email: string
): Uint8Array => new TextEncoder().encode([
  'peerly-rendezvous-lookup-v1',
  providerId,
  deviceKeyId,
  String(timestamp),
  nonce,
  email,
].join('\n'))

/** Resolve an email to an opaque, deployment-keyed capability after live OIDC/device authentication. */
export async function lookupRendezvousId(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized || !authCredentialProvider || typeof fetch !== 'function') return null
  const cachedId = rendezvousCache.get(normalized)
  if (cachedId) return cachedId
  try {
    const auth = await authCredentialProvider()
    if (!auth?.token || !auth.providerId) return null
    const deviceKeyId = await auth.signer.publicKeyId()
    const timestamp = Date.now()
    const nonce = crypto.randomUUID()
    const signature = await auth.signer.sign(
      rendezvousProof(auth.providerId, deviceKeyId, timestamp, nonce, normalized)
    )
    const response = await fetch('/api/rendezvous/lookup', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.token}`,
        'content-type': 'application/json',
        'x-peerly-provider': auth.providerId,
        'x-peerly-device-key': deviceKeyId,
        'x-peerly-request-ts': String(timestamp),
        'x-peerly-request-nonce': nonce,
        'x-peerly-request-signature': signature,
      },
      body: JSON.stringify({ email: normalized }),
    })
    if (!response.ok) return null
    const value = await response.json() as { rendezvousId?: unknown }
    if (typeof value.rendezvousId !== 'string' || value.rendezvousId.length < 32) return null
    rendezvousCache.set(normalized, value.rendezvousId)
    return value.rendezvousId
  } catch {
    return null
  }
}

export function clearRuntimeNetworkCredentials(): void {
  cached = null
  pending = null
  rendezvousCache.clear()
}
