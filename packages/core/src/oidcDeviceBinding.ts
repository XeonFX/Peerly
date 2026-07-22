import type { DeviceKeyId } from './deviceIdentity.js'
import { verifyGoogleIdToken } from './googleIdToken.js'
import {
  verifyOidcIdToken,
  type OidcIdTokenClaims,
  type VerifyOidcIdTokenOptions,
} from './oidcIdToken.js'
import { deriveUserId } from './userId.js'

export type OidcDeviceAttestation = {
  providerId: string
  idToken: string
}

export type VerifiedDeviceBinding = {
  providerId: string
  deviceKeyId: DeviceKeyId
  userId: string
  claims: OidcIdTokenClaims
}

function validAttestation(raw: unknown): raw is OidcDeviceAttestation {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as Partial<OidcDeviceAttestation>
  return (
    typeof value.providerId === 'string' && value.providerId.length > 0 && value.providerId.length <= 40 &&
    typeof value.idToken === 'string' && value.idToken.length > 0 && value.idToken.length <= 16_000
  )
}

/**
 * Verify an OIDC token whose nonce is the device public-key id, and bind its
 * issuer/subject-derived user id to a signed peer message. The caller must
 * still verify the outer message signature with `deviceKeyId`.
 */
export async function verifyOidcDeviceBinding(
  raw: unknown,
  expected: { providerId: string; deviceKeyId: DeviceKeyId; userId: string },
  options: Omit<VerifyOidcIdTokenOptions, 'expectedNonce'>
): Promise<VerifiedDeviceBinding | null> {
  if (!validAttestation(raw) || raw.providerId !== expected.providerId) return null
  try {
    const claims = await verifyOidcIdToken(raw.idToken, {
      ...options,
      expectedNonce: expected.deviceKeyId,
    })
    const userId = await deriveUserId(claims.iss, claims.sub)
    if (userId !== expected.userId) return null
    return {
      providerId: raw.providerId,
      deviceKeyId: expected.deviceKeyId,
      userId,
      claims,
    }
  } catch {
    return null
  }
}

/** Google-pinned convenience wrapper used by HeyHubs and Google-only flows. */
export async function verifyGoogleDeviceBinding(
  raw: unknown,
  expected: { deviceKeyId: DeviceKeyId; userId: string; clientId: string; atTime?: number; fetchJwks?: import('./oidcIdToken.js').JwksFetcher }
): Promise<VerifiedDeviceBinding | null> {
  if (!validAttestation(raw) || raw.providerId !== 'google') return null
  try {
    const claims = await verifyGoogleIdToken(raw.idToken, {
      expectedAudience: expected.clientId,
      expectedNonce: expected.deviceKeyId,
      now: expected.atTime,
      fetchJwks: expected.fetchJwks,
    })
    const userId = await deriveUserId(claims.iss, claims.sub)
    if (userId !== expected.userId) return null
    return {
      providerId: 'google',
      deviceKeyId: expected.deviceKeyId,
      userId,
      claims,
    }
  } catch {
    return null
  }
}

export function parseOidcDeviceAttestation(raw: unknown): OidcDeviceAttestation | null {
  return validAttestation(raw) ? { providerId: raw.providerId, idToken: raw.idToken } : null
}
