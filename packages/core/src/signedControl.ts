import { encodeCanonicalLines } from './canonical.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import type { DeviceSigner } from './textChatSigning.js'
import type { OidcDeviceAttestation } from './oidcDeviceBinding.js'

export type SignedControl<T> = {
  kind: string
  userId: string
  deviceKeyId: DeviceKeyId
  ts: number
  nonce: string
  payload: T
  attestation?: OidcDeviceAttestation
  sig: string
}

export const SIGNED_CONTROL_MAX_AGE_MS = 2 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 30_000

function controlBytes<T>(scheme: string, message: Omit<SignedControl<T>, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    scheme,
    message.kind,
    message.userId,
    message.deviceKeyId,
    String(message.ts),
    message.nonce,
    JSON.stringify(message.payload),
    JSON.stringify(message.attestation ?? null),
  ])
}

export async function signControl<T>(
  signer: DeviceSigner,
  scheme: string,
  kind: string,
  userId: string,
  payload: T,
  options?: { now?: number; attestation?: OidcDeviceAttestation }
): Promise<SignedControl<T>> {
  const body = {
    kind,
    userId: userId.trim(),
    deviceKeyId: await signer.publicKeyId(),
    ts: options?.now ?? Date.now(),
    nonce: crypto.randomUUID(),
    payload,
    ...(options?.attestation ? { attestation: options.attestation } : {}),
  }
  return { ...body, sig: await signer.sign(controlBytes(scheme, body)) }
}

export async function verifySignedControl<T>(
  raw: unknown,
  scheme: string,
  expectedKind: string,
  now: number = Date.now()
): Promise<SignedControl<T> | null> {
  if (typeof raw !== 'object' || raw === null) return null
  const message = raw as Partial<SignedControl<T>>
  if (message.kind !== expectedKind) return null
  if (typeof message.userId !== 'string' || !message.userId.trim() || message.userId.length > 256) return null
  if (typeof message.deviceKeyId !== 'string' || !message.deviceKeyId || message.deviceKeyId.length > 512) return null
  if (typeof message.ts !== 'number' || !Number.isFinite(message.ts)) return null
  if (message.ts > now + MAX_FUTURE_SKEW_MS || now - message.ts > SIGNED_CONTROL_MAX_AGE_MS) return null
  if (typeof message.nonce !== 'string' || message.nonce.length < 8 || message.nonce.length > 128) return null
  if (typeof message.sig !== 'string' || !message.sig || message.sig.length > 512) return null
  if (!('payload' in message)) return null
  if (message.attestation !== undefined) {
    if (!message.attestation || typeof message.attestation !== 'object') return null
    if (typeof message.attestation.providerId !== 'string' || typeof message.attestation.idToken !== 'string') return null
  }
  const normalized = message as SignedControl<T>
  const valid = await verifyWithDeviceKeyId(
    normalized.deviceKeyId,
    controlBytes(scheme, normalized),
    normalized.sig
  )
  return valid ? normalized : null
}

export function createSignedControlReplayGuard(
  maxEntries: number = 2_000,
  maxAgeMs: number = SIGNED_CONTROL_MAX_AGE_MS
) {
  const seen = new Map<string, number>()
  return {
    accept(message: Pick<SignedControl<unknown>, 'deviceKeyId' | 'nonce' | 'ts'>): boolean {
      const key = `${message.deviceKeyId}:${message.nonce}`
      if (seen.has(key)) return false
      seen.set(key, message.ts)
      while (seen.size > maxEntries) seen.delete(seen.keys().next().value!)
      return true
    },
    prune(now: number = Date.now()): void {
      for (const [key, ts] of seen) if (now - ts > maxAgeMs) seen.delete(key)
    },
    clear(): void {
      seen.clear()
    },
  }
}
