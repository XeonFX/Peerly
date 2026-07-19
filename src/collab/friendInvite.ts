import { encodeCanonicalLines } from '@peerly/core'
import type { DeviceSigner } from '@peerly/core'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity'
import { hashEmail, isPlausibleEmail, normalizeEmail } from './emailHash'

/**
 * Friend invite wire protocol for the Peerly presence lobby.
 *
 * Delivery is presence-based: the inviter types an email; when a peer with
 * that email-hash is online, a signed invite is sent directed. No mailbox.
 */

export const FRIEND_INVITE_SCHEME = 'peerly-friend-invite-v1'
export const FRIEND_INVITE_RESPONSE_SCHEME = 'peerly-friend-invite-resp-v1'

const MAX_NAME = 80
const HEX64 = /^[0-9a-f]{64}$/i
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type FriendInvitePayload = {
  v: 1
  inviteId: string
  fromUserId: string
  fromName: string
  /**
   * Inviter's email. Directed only to the matching peer (presence match on
   * toEmailHash), so the invitee can store a useful friend record. Presence
   * itself still carries only hashes.
   */
  fromEmail: string
  fromEmailHash: string
  toEmailHash: string
  ts: number
  deviceKeyId: DeviceKeyId
  sig: string
}

export type FriendInviteResponsePayload = {
  v: 1
  inviteId: string
  /** True = accept and become friends; false = decline. */
  accept: boolean
  /** The person who is responding (the invitee). */
  fromUserId: string
  fromName: string
  /** Invitee's email only on accept (inviter already knew the hash target). */
  fromEmail?: string
  /** Original inviter userId. */
  toUserId: string
  ts: number
  deviceKeyId: DeviceKeyId
  sig: string
}

export type PresencePayload = {
  userId: string
  name: string
  emailHash: string
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
    invite.fromEmailHash,
    invite.toEmailHash,
    String(invite.ts),
    invite.deviceKeyId,
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
    response.toUserId,
    String(response.ts),
    response.deviceKeyId,
  ])
}

export async function createFriendInvite(
  signer: DeviceSigner,
  input: {
    inviteId: string
    fromUserId: string
    fromName: string
    fromEmail: string
    toEmail: string
  }
): Promise<FriendInvitePayload> {
  if (!isPlausibleEmail(input.fromEmail) || !isPlausibleEmail(input.toEmail)) {
    throw new Error('Invalid email')
  }
  const fromEmail = normalizeEmail(input.fromEmail)
  const fromEmailHash = await hashEmail(fromEmail)
  const toEmailHash = await hashEmail(input.toEmail)
  const base: Omit<FriendInvitePayload, 'sig'> = {
    v: 1,
    inviteId: input.inviteId,
    fromUserId: input.fromUserId,
    fromName: input.fromName.trim().slice(0, MAX_NAME) || input.fromUserId.slice(0, 12),
    fromEmail,
    fromEmailHash,
    toEmailHash,
    ts: Date.now(),
    deviceKeyId: await signer.publicKeyId(),
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
  }
): Promise<FriendInviteResponsePayload> {
  if (input.accept && !isPlausibleEmail(input.fromEmail)) {
    throw new Error('Invalid email')
  }
  const base: Omit<FriendInviteResponsePayload, 'sig'> = {
    v: 1,
    inviteId: input.inviteId,
    accept: input.accept,
    fromUserId: input.fromUserId,
    fromName: input.fromName.trim().slice(0, MAX_NAME) || input.fromUserId.slice(0, 12),
    ...(input.accept ? { fromEmail: normalizeEmail(input.fromEmail) } : {}),
    toUserId: input.toUserId,
    ts: Date.now(),
    deviceKeyId: await signer.publicKeyId(),
  }
  const sig = await signer.sign(friendInviteResponseBytes(base))
  return { ...base, sig }
}

function inviteShapeOk(msg: Partial<FriendInvitePayload>): msg is FriendInvitePayload {
  return (
    msg.v === 1 &&
    typeof msg.inviteId === 'string' &&
    !!msg.inviteId &&
    msg.inviteId.length <= 64 &&
    typeof msg.fromUserId === 'string' &&
    !!msg.fromUserId &&
    typeof msg.fromName === 'string' &&
    msg.fromName.length <= MAX_NAME &&
    typeof msg.fromEmail === 'string' &&
    isPlausibleEmail(msg.fromEmail) &&
    typeof msg.fromEmailHash === 'string' &&
    HEX64.test(msg.fromEmailHash) &&
    typeof msg.toEmailHash === 'string' &&
    HEX64.test(msg.toEmailHash) &&
    typeof msg.ts === 'number' &&
    Number.isFinite(msg.ts) &&
    typeof msg.deviceKeyId === 'string' &&
    !!msg.deviceKeyId &&
    typeof msg.sig === 'string' &&
    !!msg.sig
  )
}

function responseShapeOk(
  msg: Partial<FriendInviteResponsePayload>
): msg is FriendInviteResponsePayload {
  return (
    msg.v === 1 &&
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
    typeof msg.toUserId === 'string' &&
    !!msg.toUserId &&
    msg.fromUserId !== msg.toUserId &&
    typeof msg.ts === 'number' &&
    Number.isFinite(msg.ts) &&
    typeof msg.deviceKeyId === 'string' &&
    !!msg.deviceKeyId &&
    typeof msg.sig === 'string' &&
    !!msg.sig
  )
}

export async function verifyFriendInvite(invite: FriendInvitePayload): Promise<boolean> {
  if (!inviteShapeOk(invite)) return false
  if (Date.now() - invite.ts > INVITE_TTL_MS) return false
  if (invite.fromEmailHash === invite.toEmailHash) return false
  // Claimed email must match the signed hash (prevents display spoofing).
  if ((await hashEmail(invite.fromEmail)) !== invite.fromEmailHash.toLowerCase()) return false
  return verifyWithDeviceKeyId(invite.deviceKeyId, friendInviteBytes(invite), invite.sig)
}

export async function verifyFriendInviteResponse(
  response: FriendInviteResponsePayload
): Promise<boolean> {
  if (!responseShapeOk(response)) return false
  if (Date.now() - response.ts > INVITE_TTL_MS) return false
  if (response.accept && !response.fromEmail) return false
  if (!response.accept && response.fromEmail) return false
  return verifyWithDeviceKeyId(
    response.deviceKeyId,
    friendInviteResponseBytes(response),
    response.sig
  )
}

/** Validate an untrusted wire presence blob; null if unusable. */
export function parsePresencePayload(raw: unknown): PresencePayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as Partial<PresencePayload>
  if (typeof msg.userId !== 'string' || !msg.userId.trim()) return null
  if (typeof msg.emailHash !== 'string' || !HEX64.test(msg.emailHash)) return null
  const name =
    typeof msg.name === 'string' && msg.name.trim()
      ? msg.name.trim().slice(0, MAX_NAME)
      : msg.userId.slice(0, 12)
  return {
    userId: msg.userId.trim(),
    name,
    emailHash: msg.emailHash.toLowerCase(),
  }
}

/** Validate an untrusted invite wire blob (shape only — verify signature separately). */
export function parseFriendInvitePayload(raw: unknown): FriendInvitePayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as Partial<FriendInvitePayload>
  if (!inviteShapeOk(msg)) return null
  return {
    v: 1,
    inviteId: msg.inviteId,
    fromUserId: msg.fromUserId.trim(),
    fromName: msg.fromName.trim().slice(0, MAX_NAME),
    fromEmail: normalizeEmail(msg.fromEmail),
    fromEmailHash: msg.fromEmailHash.toLowerCase(),
    toEmailHash: msg.toEmailHash.toLowerCase(),
    ts: msg.ts,
    deviceKeyId: msg.deviceKeyId,
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
    v: 1,
    inviteId: msg.inviteId,
    accept: msg.accept,
    fromUserId: msg.fromUserId.trim(),
    fromName: msg.fromName.trim().slice(0, MAX_NAME),
    ...(msg.fromEmail ? { fromEmail: normalizeEmail(msg.fromEmail) } : {}),
    toUserId: msg.toUserId.trim(),
    ts: msg.ts,
    deviceKeyId: msg.deviceKeyId,
    sig: msg.sig,
  }
}

export { INVITE_TTL_MS }
