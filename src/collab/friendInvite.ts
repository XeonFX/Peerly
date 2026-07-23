import {
  encodeCanonicalLines,
  generateDmSecret,
  isValidDmSecret,
  parsePresencePayload as coreParsePresence,
  type DeviceSigner,
  type OidcDeviceAttestation,
  type PresencePayload,
} from '@peerly/core'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity'
import { isPlausibleEmail, normalizeEmail } from './emailHash'

export type { PresencePayload }

/**
 * Friend invite wire protocol for the Peerly presence lobby.
 *
 * Delivery is presence-based: the inviter types an email, resolves it through
 * the authenticated rendezvous service, and sends the invite directly to the
 * peer advertising that opaque capability. No mailbox or deterministic email
 * identifier is placed on the wire.
 */

export const FRIEND_INVITE_SCHEME = 'peerly-friend-invite-v4'
export const FRIEND_INVITE_RESPONSE_SCHEME = 'peerly-friend-invite-resp-v4'

const MAX_NAME = 80
const RENDEZVOUS_CAPABILITY = /^[A-Za-z0-9_-]{32,128}$/
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

export type FriendInvitePayload = {
  v: 2
  inviteId: string
  fromUserId: string
  fromName: string
  /**
   * Inviter's email. The OIDC/device attestation binds this claim, and the
   * envelope is directed only to the peer matching `toRendezvousId`.
   */
  fromEmail: string
  toRendezvousId: string
  dmSecret: string
  ts: number
  deviceKeyId: DeviceKeyId
  attestation: OidcDeviceAttestation
  sig: string
}

export type FriendInviteResponsePayload = {
  v: 2
  inviteId: string
  /** True = accept and become friends; false = decline. */
  accept: boolean
  /** The person who is responding (the invitee). */
  fromUserId: string
  fromName: string
  /** Invitee's OIDC-bound email, disclosed only on accept. */
  fromEmail?: string
  dmSecret?: string
  /** Original inviter userId. */
  toUserId: string
  ts: number
  deviceKeyId: DeviceKeyId
  attestation: OidcDeviceAttestation
  sig: string
}

export function friendInviteBytes(
  invite: Omit<FriendInvitePayload, 'sig'>
): Uint8Array {
  return encodeCanonicalLines([
    FRIEND_INVITE_SCHEME,
    String(invite.v),
    invite.inviteId,
    invite.fromUserId,
    invite.fromName,
    invite.fromEmail,
    invite.toRendezvousId,
    invite.dmSecret,
    String(invite.ts),
    invite.deviceKeyId,
    invite.attestation.providerId,
    invite.attestation.idToken,
  ])
}

export function friendInviteResponseBytes(
  response: Omit<FriendInviteResponsePayload, 'sig'>
): Uint8Array {
  return encodeCanonicalLines([
    FRIEND_INVITE_RESPONSE_SCHEME,
    String(response.v),
    response.inviteId,
    response.accept ? '1' : '0',
    response.fromUserId,
    response.fromName,
    response.fromEmail ?? '',
    response.dmSecret ?? '',
    response.toUserId,
    String(response.ts),
    response.deviceKeyId,
    response.attestation.providerId,
    response.attestation.idToken,
  ])
}

export async function createFriendInvite(
  signer: DeviceSigner,
  input: {
    inviteId: string
    fromUserId: string
    fromName: string
    fromEmail: string
    toRendezvousId: string
    attestation: OidcDeviceAttestation
  }
): Promise<FriendInvitePayload> {
  if (
    !isPlausibleEmail(input.fromEmail) ||
    !RENDEZVOUS_CAPABILITY.test(input.toRendezvousId)
  ) {
    throw new Error('Invalid invite target')
  }
  const fromEmail = normalizeEmail(input.fromEmail)
  const base: Omit<FriendInvitePayload, 'sig'> = {
    v: 2,
    inviteId: input.inviteId,
    fromUserId: input.fromUserId,
    fromName: input.fromName.trim().slice(0, MAX_NAME) || input.fromUserId.slice(0, 12),
    fromEmail,
    toRendezvousId: input.toRendezvousId,
    dmSecret: generateDmSecret(),
    ts: Date.now(),
    deviceKeyId: await signer.publicKeyId(),
    attestation: input.attestation,
  }
  const sig = await signer.sign(friendInviteBytes(base))
  return { ...base, sig }
}

export async function createFriendInviteResponse(
  signer: DeviceSigner,
  input: {
    inviteId: string
    accept: boolean
    fromUserId: string
    fromName: string
    fromEmail: string
    toUserId: string
    dmSecret?: string
    attestation: OidcDeviceAttestation
  }
): Promise<FriendInviteResponsePayload> {
  if (input.accept && !isPlausibleEmail(input.fromEmail)) {
    throw new Error('Invalid email')
  }
  const base: Omit<FriendInviteResponsePayload, 'sig'> = {
    v: 2,
    inviteId: input.inviteId,
    accept: input.accept,
    fromUserId: input.fromUserId,
    fromName: input.fromName.trim().slice(0, MAX_NAME) || input.fromUserId.slice(0, 12),
    ...(input.accept ? { fromEmail: normalizeEmail(input.fromEmail) } : {}),
    ...(input.accept && input.dmSecret ? { dmSecret: input.dmSecret.toLowerCase() } : {}),
    toUserId: input.toUserId,
    ts: Date.now(),
    deviceKeyId: await signer.publicKeyId(),
    attestation: input.attestation,
  }
  const sig = await signer.sign(friendInviteResponseBytes(base))
  return { ...base, sig }
}

function inviteShapeOk(msg: Partial<FriendInvitePayload>): msg is FriendInvitePayload {
  return (
    msg.v === 2 &&
    typeof msg.inviteId === 'string' &&
    !!msg.inviteId &&
    msg.inviteId.length <= 64 &&
    typeof msg.fromUserId === 'string' &&
    !!msg.fromUserId &&
    typeof msg.fromName === 'string' &&
    msg.fromName.length <= MAX_NAME &&
    typeof msg.fromEmail === 'string' &&
    isPlausibleEmail(msg.fromEmail) &&
    typeof msg.toRendezvousId === 'string' &&
    RENDEZVOUS_CAPABILITY.test(msg.toRendezvousId) &&
    isValidDmSecret(msg.dmSecret) &&
    typeof msg.ts === 'number' &&
    Number.isFinite(msg.ts) &&
    typeof msg.deviceKeyId === 'string' &&
    !!msg.deviceKeyId &&
    typeof msg.attestation?.providerId === 'string' &&
    typeof msg.attestation?.idToken === 'string' &&
    typeof msg.sig === 'string' &&
    !!msg.sig
  )
}

function responseShapeOk(
  msg: Partial<FriendInviteResponsePayload>
): msg is FriendInviteResponsePayload {
  return (
    msg.v === 2 &&
    typeof msg.inviteId === 'string' &&
    !!msg.inviteId &&
    msg.inviteId.length <= 64 &&
    typeof msg.accept === 'boolean' &&
    typeof msg.fromUserId === 'string' &&
    !!msg.fromUserId &&
    typeof msg.fromName === 'string' &&
    msg.fromName.length <= MAX_NAME &&
    (msg.fromEmail === undefined ||
      (typeof msg.fromEmail === 'string' && isPlausibleEmail(msg.fromEmail))) &&
    (msg.dmSecret === undefined || isValidDmSecret(msg.dmSecret)) &&
    typeof msg.toUserId === 'string' &&
    !!msg.toUserId &&
    msg.fromUserId !== msg.toUserId &&
    typeof msg.ts === 'number' &&
    Number.isFinite(msg.ts) &&
    typeof msg.deviceKeyId === 'string' &&
    !!msg.deviceKeyId &&
    typeof msg.attestation?.providerId === 'string' &&
    typeof msg.attestation?.idToken === 'string' &&
    typeof msg.sig === 'string' &&
    !!msg.sig
  )
}

export async function verifyFriendInvite(invite: FriendInvitePayload): Promise<boolean> {
  if (!inviteShapeOk(invite)) return false
  const age = Date.now() - invite.ts
  if (age > INVITE_TTL_MS || age < -MAX_CLOCK_SKEW_MS) return false
  return verifyWithDeviceKeyId(invite.deviceKeyId, friendInviteBytes(invite), invite.sig)
}

export async function verifyFriendInviteResponse(
  response: FriendInviteResponsePayload
): Promise<boolean> {
  if (!responseShapeOk(response)) return false
  const age = Date.now() - response.ts
  if (age > INVITE_TTL_MS || age < -MAX_CLOCK_SKEW_MS) return false
  if (response.accept && !response.fromEmail) return false
  if (response.accept && !response.dmSecret) return false
  if (!response.accept && response.fromEmail) return false
  if (!response.accept && response.dmSecret) return false
  return verifyWithDeviceKeyId(
    response.deviceKeyId,
    friendInviteResponseBytes(response),
    response.sig
  )
}

/** Peerly lobby presence requires a deployment-keyed rendezvous capability. */
export function parsePresencePayload(raw: unknown): PresencePayload | null {
  return coreParsePresence(raw, { requireRendezvousId: true })
}

/** Validate an untrusted invite wire blob (shape only — verify signature separately). */
export function parseFriendInvitePayload(raw: unknown): FriendInvitePayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as Partial<FriendInvitePayload>
  if (!inviteShapeOk(msg)) return null
  return {
    v: 2,
    inviteId: msg.inviteId,
    fromUserId: msg.fromUserId.trim(),
    fromName: msg.fromName.trim().slice(0, MAX_NAME),
    fromEmail: normalizeEmail(msg.fromEmail),
    toRendezvousId: msg.toRendezvousId,
    dmSecret: msg.dmSecret.toLowerCase(),
    ts: msg.ts,
    deviceKeyId: msg.deviceKeyId,
    attestation: {
      providerId: msg.attestation.providerId,
      idToken: msg.attestation.idToken,
    },
    sig: msg.sig,
  }
}

export function parseFriendInviteResponsePayload(
  raw: unknown
): FriendInviteResponsePayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as Partial<FriendInviteResponsePayload>
  if (!responseShapeOk(msg)) return null
  return {
    v: 2,
    inviteId: msg.inviteId,
    accept: msg.accept,
    fromUserId: msg.fromUserId.trim(),
    fromName: msg.fromName.trim().slice(0, MAX_NAME),
    ...(msg.fromEmail ? { fromEmail: normalizeEmail(msg.fromEmail) } : {}),
    ...(msg.dmSecret ? { dmSecret: msg.dmSecret.toLowerCase() } : {}),
    toUserId: msg.toUserId.trim(),
    ts: msg.ts,
    deviceKeyId: msg.deviceKeyId,
    attestation: {
      providerId: msg.attestation.providerId,
      idToken: msg.attestation.idToken,
    },
    sig: msg.sig,
  }
}

export { INVITE_TTL_MS }
