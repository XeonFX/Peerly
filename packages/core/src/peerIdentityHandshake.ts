import type { DataPayload, PeerHandshake } from '@trystero-p2p/core'
import { bytesToBase64Url } from './base64url.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import type { DeviceSigner } from './textChatSigning.js'
import { isCertificateAttestation, type IdentityAttestation } from './identityAttestation.js'

export type PeerIdentityAttestation = IdentityAttestation & {
  deviceKeyId: DeviceKeyId
  userId: string
}

export type PeerIdentityHandshakeDeps<TVerified> = {
  signer: DeviceSigner
  /** What both peers share and the proofs are bound to (the room or workspace); empty by default. */
  context?: string
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
  const value = raw as { providerId?: string; idToken?: string; certificate?: string; deviceKeyId?: string; userId?: string }
  if (typeof value.deviceKeyId !== 'string' || !value.deviceKeyId || value.deviceKeyId.length > 512 ||
      typeof value.userId !== 'string' || !value.userId || value.userId.length > 256) return null
  if (!isCertificateAttestation(value) && (
      typeof value.providerId !== 'string' || !value.providerId || value.providerId.length > 40 ||
      typeof value.idToken !== 'string' || !value.idToken || value.idToken.length > 16_000)) return null
  return value as PeerIdentityAttestation
}

/** The handshake protocol a challenge message carries; a peer without it runs an older version. */
export const PEER_HANDSHAKE_VERSION = 2
/** What a proof signs first, so it is no signature over anything else this device key signs. */
const PROOF_DOMAIN = 'peerly-peer-handshake-v2'
/** A challenge: 32 random bytes, base64url without padding. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/

const deny = (reason: string): never => {
  throw new Error(`identity verification failed: ${reason}`)
}

function parseChallenge(raw: unknown): string {
  const message = raw && typeof raw === 'object' ? (raw as { v?: unknown; nonce?: unknown }) : null
  if (message && message.v === undefined && typeof message.nonce === 'string') {
    deny('the peer runs an older version of Peerly – it has to reload')
  }
  if (message?.v !== PEER_HANDSHAKE_VERSION || typeof message.nonce !== 'string' || !CHALLENGE.test(message.nonce)) {
    deny('malformed challenge')
  }
  return message!.nonce as string
}

function parseProof(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const signature = (raw as { signature?: unknown }).signature
  return typeof signature === 'string' && signature.length > 0 && signature.length <= 512
    ? signature
    : null
}

/**
 * The bytes a handshake proof signs: the protocol, the `context` both peers share (the workspace), the signer's and the
 * verifier's device keys and both challenges, the verifier's first. A proof is bound to this session between these two
 * devices: it cannot be relayed to another peer, reflected back, or passed off as a member list, a chat message or any
 * other signature of this device key, whose payloads never start with this domain.
 */
export function handshakeProofBytes(proof: {
  context: string
  signerKeyId: DeviceKeyId
  verifierKeyId: DeviceKeyId
  verifierChallenge: string
  signerChallenge: string
}): Uint8Array {
  const { context, signerKeyId, verifierKeyId, verifierChallenge, signerChallenge } = proof
  return new TextEncoder().encode(
    JSON.stringify([PROOF_DOMAIN, context, signerKeyId, verifierKeyId, verifierChallenge, signerChallenge])
  )
}

/** One step of the handshake: the initiator sends first, the responder answers. */
async function exchange(send: Send, receive: Receive, isInitiator: boolean, message: DataPayload): Promise<unknown> {
  if (isInitiator) {
    await send(message)
    return (await receive()).data
  }
  const { data } = await receive()
  await send(message)
  return data
}

type Send = Parameters<PeerHandshake>[1]
type Receive = Parameters<PeerHandshake>[2]

/**
 * Live proof of possession, once both attestations are verified: each side sends a fresh challenge and signs the
 * session's transcript (`handshakeProofBytes`) with the device key it attested. The peer's challenge is checked before
 * anything is signed – exactly 32 random bytes, current protocol – so a peer cannot choose what this key signs.
 */
export async function proveDeviceKeys(options: {
  send: Send
  receive: Receive
  isInitiator: boolean
  signer: DeviceSigner
  myKeyId: DeviceKeyId
  theirKeyId: DeviceKeyId
  context: string
}): Promise<void> {
  const { send, receive, isInitiator, signer, myKeyId, theirKeyId, context } = options
  // Our own key, or our own challenge sent back, would let this side's proof pass for theirs.
  if (theirKeyId === myKeyId) deny('the peer presents this device\'s own key')
  const myChallenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const theirChallenge = parseChallenge(
    await exchange(send, receive, isInitiator, { v: PEER_HANDSHAKE_VERSION, nonce: myChallenge })
  )
  if (theirChallenge === myChallenge) deny('reflected challenge')
  const signature = await signer.sign(handshakeProofBytes({
    context, signerKeyId: myKeyId, verifierKeyId: theirKeyId, verifierChallenge: theirChallenge, signerChallenge: myChallenge,
  }))
  const theirProof = parseProof(await exchange(send, receive, isInitiator, { signature }))
  const expected = handshakeProofBytes({
    context, signerKeyId: theirKeyId, verifierKeyId: myKeyId, verifierChallenge: myChallenge, signerChallenge: theirChallenge,
  })
  if (!theirProof || !(await verifyWithDeviceKeyId(theirKeyId, expected, theirProof))) {
    deny('device key proof-of-possession failed (likely a replayed ID token)')
  }
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

    await proveDeviceKeys({
      send, receive, isInitiator, signer: deps.signer,
      myKeyId: mine.deviceKeyId, theirKeyId: theirs.deviceKeyId, context: deps.context ?? '',
    })
    deps.onPeerVerified?.(peerId, verified, theirs)
  }
}
