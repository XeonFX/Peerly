import type { DeviceSigner } from './textChatSigning.js'
import type { TurnServer } from './relays.js'

export type RuntimeNetworkCredentials = {
  relayTicket?: string
  iceServers?: TurnServer[]
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

/** Register the live, device-bound OIDC credential used to mint relay/TURN tickets. */
export function configureRuntimeAuthCredentialProvider(
  provider: (() => RuntimeAuthCredential | null | Promise<RuntimeAuthCredential | null>) | null
): void {
  authCredentialProvider = provider
  cached = null
  pending = null
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
        ...(Array.isArray(value.iceServers) ? { iceServers: value.iceServers } : {}),
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

export function clearRuntimeNetworkCredentials(): void {
  cached = null
  pending = null
}
