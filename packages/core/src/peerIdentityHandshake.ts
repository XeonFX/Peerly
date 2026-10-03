import type { DataPayload, PeerHandshake } from '@trystero-p2p/core'
import { bytesToBase64Url } from './base64url.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import { parseTabCertificate, verifyTabCertificate, type TabCertificate, type TabSession } from './tabSession.js'
import { isCertificateAttestation, type IdentityAttestation } from './identityAttestation.js'

/** What the app attests to; the handshake adds this tab's certificate. */
export type PeerIdentityClaim = IdentityAttestation & {
  deviceKeyId: DeviceKeyId
  userId: string
}

export type PeerIdentityAttestation = PeerIdentityClaim & {
  /** This tab's key, certified by `deviceKeyId` for the handshake's context (see tabSession.ts). */
  tab: TabCertificate
}

export type PeerIdentityHandshakeDeps<TVerified> = {
  /** This tab: its key signs the proofs, and the device key behind it certifies it. */
  tab: TabSession
  /** What both peers share and the proofs are bound to (the room or workspace); empty by default. */
  context?: string
  getAttestation: () => Promise<PeerIdentityClaim>
  verifyAttestation: (attestation: PeerIdentityAttestation) => Promise<TVerified | null>
  /** Whether `tabKeyId` belongs to another open tab of this browser (see `proveTabKeys`). */
  isSiblingTab?: (tabKeyId: DeviceKeyId) => Promise<boolean>
  onPeerVerified?: (
    peerId: string,
    verified: TVerified,
    attestation: PeerIdentityAttestation
  ) => void
}

function parseAttestation(raw: unknown): PeerIdentityAttestation | null {
  if (!raw || typeof raw !== 'object') return null
  const rawTab = (raw as { tab?: unknown }).tab
  const value = raw as { providerId?: string; idToken?: string; certificate?: string; deviceKeyId?: string; userId?: string; tab?: unknown }
  if (typeof value.deviceKeyId !== 'string' || !value.deviceKeyId || value.deviceKeyId.length > 512 ||
      typeof value.userId !== 'string' || !value.userId || value.userId.length > 256) return null
  if (!isCertificateAttestation(value) && (
      typeof value.providerId !== 'string' || !value.providerId || value.providerId.length > 40 ||
      typeof value.idToken !== 'string' || !value.idToken || value.idToken.length > 16_000)) return null
  if (rawTab === undefined) olderPeer()
  const tab = parseTabCertificate(rawTab)
  if (!tab) return null
  return { ...(value as PeerIdentityAttestation), tab }
}

/** The handshake protocol a challenge message carries; a peer without it runs an older version. */
export const PEER_HANDSHAKE_VERSION = 3
/** What a proof signs first, so it is no signature over anything else a tab key signs. */
const PROOF_DOMAIN = 'peerly-peer-handshake-v3'
/** A challenge: 32 random bytes, base64url without padding. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/** Every handshake refusal starts with this, so a UI can tell a denied peer from a network failure. */
export const IDENTITY_DENIED_PREFIX = 'identity verification failed'

/** Refusal reasons a UI may want to recognise. */
export const OLDER_PEER_REASON = 'the peer runs an older version of Peerly – it has to reload'
export const STALE_TAB_REASON = "the peer's tab session has expired – it has to reconnect"
export const UNKNOWN_SIBLING_REASON = "the peer presents this device's key from a tab this browser does not have open"

function deny(reason: string): never {
  throw new Error(`${IDENTITY_DENIED_PREFIX}: ${reason}`)
}

/** A peer from before tab keys (or before protocol versions): it must reload, and nothing is signed for it. */
export function olderPeer(): never {
  deny(OLDER_PEER_REASON)
}

function parseChallenge(raw: unknown): string {
  const message = raw && typeof raw === 'object' ? (raw as { v?: unknown; nonce?: unknown }) : null
  if (message && typeof message.nonce === 'string' &&
      (message.v === undefined || (typeof message.v === 'number' && message.v < PEER_HANDSHAKE_VERSION))) {
    olderPeer()
  }
  if (message?.v !== PEER_HANDSHAKE_VERSION || typeof message.nonce !== 'string' || !CHALLENGE.test(message.nonce)) {
    deny('malformed challenge')
  }
  return message.nonce
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
 * verifier's device and tab keys, and both challenges, the verifier's first. A proof is bound to this session between
 * these two tabs: it cannot be replayed into another session, presented to a tab other than the verifier it names (two
 * tabs of one browser share the device key, never the tab key), reflected back, or passed off as any other signature:
 * tab keys sign nothing else, and device keys never sign a proof. It is not bound to the WebRTC transport (no DTLS
 * fingerprint), so a peer that relays attestations, challenges and proofs between two members in real time still sits
 * in the middle of their channel.
 */
export function handshakeProofBytes(proof: {
  context: string
  signerKeyId: DeviceKeyId
  signerTabKeyId: DeviceKeyId
  verifierKeyId: DeviceKeyId
  verifierTabKeyId: DeviceKeyId
  verifierChallenge: string
  signerChallenge: string
}): Uint8Array {
  const { context, signerKeyId, signerTabKeyId, verifierKeyId, verifierTabKeyId, verifierChallenge, signerChallenge } = proof
  return new TextEncoder().encode(JSON.stringify([
    PROOF_DOMAIN, context, signerKeyId, signerTabKeyId, verifierKeyId, verifierTabKeyId, verifierChallenge, signerChallenge,
  ]))
}

type Send = Parameters<PeerHandshake>[1]
type Receive = Parameters<PeerHandshake>[2]

/** One step of the handshake: the initiator sends first, the responder answers. */
export async function exchangeHandshakeStep(send: Send, receive: Receive, isInitiator: boolean, message: DataPayload): Promise<unknown> {
  if (isInitiator) {
    await send(message)
    return (await receive()).data
  }
  const { data } = await receive()
  await send(message)
  return data
}

/**
 * Live proof of possession, once both attestations are verified. First the peer's tab certificate must be signed by
 * the device key their attestation names (and so their ID token's nonce), for this context, and be current. Their tab
 * key must not be ours; if their device key is ours – another tab of this browser – `isSiblingTab` must confirm that
 * tab is open here, or the peer is refused. Then each side sends a fresh challenge and signs the session's transcript
 * (`handshakeProofBytes`) with its tab key. The peer's challenge is checked before anything is signed – exactly 32
 * random bytes, current protocol – so a peer cannot choose what a key signs.
 */
export async function proveTabKeys(options: {
  send: Send
  receive: Receive
  isInitiator: boolean
  tab: TabSession
  myKeyId: DeviceKeyId
  myTab: TabCertificate
  theirKeyId: DeviceKeyId
  theirTab: TabCertificate
  context: string
  isSiblingTab?: (tabKeyId: DeviceKeyId) => Promise<boolean>
  now?: number
}): Promise<void> {
  const { send, receive, isInitiator, tab, myKeyId, myTab, theirKeyId, theirTab, context } = options
  const check = await verifyTabCertificate(theirTab, { context, deviceKeyId: theirKeyId, now: options.now })
  if (check === 'expired') deny(STALE_TAB_REASON)
  if (check !== 'valid') deny('the tab certificate is not signed by the device key the peer attested')
  // Our own tab key, or our own challenge sent back, would let this side's proof pass for theirs.
  if (theirTab.tabKeyId === myTab.tabKeyId) deny("the peer presents this tab's own key")
  if (theirKeyId === myKeyId && !(await options.isSiblingTab?.(theirTab.tabKeyId))) deny(UNKNOWN_SIBLING_REASON)
  const myChallenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const theirChallenge = parseChallenge(
    await exchangeHandshakeStep(send, receive, isInitiator, { v: PEER_HANDSHAKE_VERSION, nonce: myChallenge })
  )
  if (theirChallenge === myChallenge) deny('reflected challenge')
  const signature = await tab.sign(handshakeProofBytes({
    context,
    signerKeyId: myKeyId, signerTabKeyId: myTab.tabKeyId,
    verifierKeyId: theirKeyId, verifierTabKeyId: theirTab.tabKeyId,
    verifierChallenge: theirChallenge, signerChallenge: myChallenge,
  }))
  const theirProof = parseProof(await exchangeHandshakeStep(send, receive, isInitiator, { signature }))
  const expected = handshakeProofBytes({
    context,
    signerKeyId: theirKeyId, signerTabKeyId: theirTab.tabKeyId,
    verifierKeyId: myKeyId, verifierTabKeyId: myTab.tabKeyId,
    verifierChallenge: myChallenge, signerChallenge: theirChallenge,
  })
  if (!theirProof || !(await verifyWithDeviceKeyId(theirTab.tabKeyId, expected, theirProof))) {
    deny('device key proof-of-possession failed (likely a replayed ID token)')
  }
}

/** Mutual OIDC identity verification plus live device-key proof of possession. */
export function createPeerIdentityHandshake<TVerified>(
  deps: PeerIdentityHandshakeDeps<TVerified>
): PeerHandshake {
  return async (peerId, send, receive, isInitiator) => {
    const context = deps.context ?? ''
    const mine = { ...(await deps.getAttestation()), tab: await deps.tab.certificate(context) } as PeerIdentityAttestation
    const theirs = parseAttestation(await exchangeHandshakeStep(send, receive, isInitiator, mine))
    if (!theirs) deny('malformed attestation')
    const verified = await deps.verifyAttestation(theirs)
    if (!verified) deny('invalid OIDC device binding')

    await proveTabKeys({
      send, receive, isInitiator, tab: deps.tab, context, isSiblingTab: deps.isSiblingTab,
      myKeyId: mine.deviceKeyId, myTab: mine.tab, theirKeyId: theirs.deviceKeyId, theirTab: theirs.tab,
    })
    deps.onPeerVerified?.(peerId, verified, theirs)
  }
}
