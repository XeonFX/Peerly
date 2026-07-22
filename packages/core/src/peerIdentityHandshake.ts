import type { PeerHandshake } from '@trystero-p2p/core'
import { bytesToBase64Url } from './base64url.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import type { DeviceSigner } from './textChatSigning.js'
import type { OidcDeviceAttestation } from './oidcDeviceBinding.js'

export type PeerIdentityAttestation = OidcDeviceAttestation & {
  deviceKeyId: DeviceKeyId
  userId: string
}

export type PeerIdentityHandshakeDeps<TVerified> = {
  signer: DeviceSigner
  getAttestation: () => Promise<PeerIdentityAttestation>
  verifyAttestation: (attestation: PeerIdentityAttestation) => Promise<TVerified | null>
  onPeerVerified?: (
    peerId: string,
    verified: TVerified,
    attestation: PeerIdentityAttestation
  ) => void
}

function parseAttestation(raw: unknown): PeerIdentityAttestation | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<PeerIdentityAttestation>
  if (
    typeof value.providerId !== 'string' || !value.providerId || value.providerId.length > 40 ||
    typeof value.idToken !== 'string' || !value.idToken || value.idToken.length > 16_000 ||
    typeof value.deviceKeyId !== 'string' || !value.deviceKeyId || value.deviceKeyId.length > 512 ||
    typeof value.userId !== 'string' || !value.userId || value.userId.length > 256
  ) return null
  return value as PeerIdentityAttestation
}

function parseChallenge(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const nonce = (raw as { nonce?: unknown }).nonce
  return typeof nonce === 'string' && nonce.length >= 32 && nonce.length <= 128 ? nonce : null
}

function parseProof(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const signature = (raw as { signature?: unknown }).signature
  return typeof signature === 'string' && signature.length > 0 && signature.length <= 512
    ? signature
    : null
}

/** Mutual OIDC identity verification plus live device-key proof of possession. */
export function createPeerIdentityHandshake<TVerified>(
  deps: PeerIdentityHandshakeDeps<TVerified>
): PeerHandshake {
  return async (peerId, send, receive, isInitiator) => {
    const mine = await deps.getAttestation()
    let rawTheirs: unknown
    if (isInitiator) {
      await send(mine)
      ;({ data: rawTheirs } = await receive())
    } else {
      ;({ data: rawTheirs } = await receive())
      await send(mine)
    }
    const theirs = parseAttestation(rawTheirs)
    if (!theirs) throw new Error('identity verification failed: malformed attestation')
    const verified = await deps.verifyAttestation(theirs)
    if (!verified) throw new Error('identity verification failed: invalid OIDC device binding')

    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
    let rawChallenge: unknown
    if (isInitiator) {
      await send({ nonce: challenge })
      ;({ data: rawChallenge } = await receive())
    } else {
      ;({ data: rawChallenge } = await receive())
      await send({ nonce: challenge })
    }
    const theirChallenge = parseChallenge(rawChallenge)
    if (!theirChallenge) throw new Error('identity verification failed: malformed challenge')
    const signature = await deps.signer.sign(new TextEncoder().encode(theirChallenge))

    let rawProof: unknown
    if (isInitiator) {
      await send({ signature })
      ;({ data: rawProof } = await receive())
    } else {
      ;({ data: rawProof } = await receive())
      await send({ signature })
    }
    const theirProof = parseProof(rawProof)
    if (!theirProof || !(await verifyWithDeviceKeyId(
      theirs.deviceKeyId,
      new TextEncoder().encode(challenge),
      theirProof
    ))) {
      throw new Error('identity verification failed: device key proof-of-possession failed')
    }
    deps.onPeerVerified?.(peerId, verified, theirs)
  }
}
