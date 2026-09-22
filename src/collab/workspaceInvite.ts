import { encodeCanonicalLines, type DeviceSigner } from '@peerly/core'
import { isEmailAllowed, verifyAllowList } from './allowList'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity'
import type { WorkspaceInvite } from './inviteLink'
import { isWorkspaceRouteId } from './workspaceRouteId'

export const WORKSPACE_INVITE_SCHEME = 'peerly-workspace-invite-v1'
export const WORKSPACE_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const MAX_NAME_LENGTH = 80
const MAX_WORKSPACE_NAME_LENGTH = 120
const MAX_MEMBERS = 500
const RENDEZVOUS_CAPABILITY = /^[A-Za-z0-9_-]{32,128}$/

/**
 * A creator-signed, directed workspace invitation.
 *
 * The workspace invite already contains the creator-signed allow-list. The
 * outer signature binds the notification metadata and opaque rendezvous target
 * to that same creator key, so another lobby participant cannot forge a
 * convincing "Alice invited you" notification around a copied invite link.
 */
export type WorkspaceInvitePayload = {
  v: 1
  inviteId: string
  fromUserId: string
  fromName: string
  toRendezvousId: string
  invite: WorkspaceInvite
  ts: number
  deviceKeyId: DeviceKeyId
  sig: string
}

export function workspaceInviteBytes(
  payload: Omit<WorkspaceInvitePayload, 'sig'>
): Uint8Array {
  const fields = [
    WORKSPACE_INVITE_SCHEME,
    String(payload.v),
    payload.inviteId,
    payload.fromUserId,
    JSON.stringify(payload.fromName),
    payload.toRendezvousId,
    String(payload.ts),
    payload.deviceKeyId,
    String(payload.invite.v),
    payload.invite.workspaceId,
    JSON.stringify(payload.invite.workspaceName),
    payload.invite.creatorKeyId,
    JSON.stringify(payload.invite.allowList.emails),
    String(payload.invite.allowList.signedAt),
    payload.invite.allowList.signature,
  ]
  // Preserve verification of v1 invitations created before route IDs existed:
  // the old canonical payload ended at the allow-list signature.
  if (payload.invite.workspaceRouteId) fields.push(payload.invite.workspaceRouteId)
  if (payload.invite.allowList.scope) fields.push(payload.invite.allowList.scope)
  return encodeCanonicalLines(fields)
}

export async function createWorkspaceInvite(
  signer: DeviceSigner,
  input: {
    inviteId: string
    fromUserId: string
    fromName: string
    toRendezvousId: string
    invite: WorkspaceInvite
  }
): Promise<WorkspaceInvitePayload> {
  const deviceKeyId = await signer.publicKeyId()
  if (deviceKeyId !== input.invite.creatorKeyId) {
    throw new Error('Only the workspace creator can deliver invitations')
  }
  if (!RENDEZVOUS_CAPABILITY.test(input.toRendezvousId)) {
    throw new Error('Invalid invitation target')
  }
  const base: Omit<WorkspaceInvitePayload, 'sig'> = {
    v: 1,
    inviteId: input.inviteId,
    fromUserId: input.fromUserId,
    fromName: input.fromName.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH),
    toRendezvousId: input.toRendezvousId,
    invite: input.invite,
    ts: Date.now(),
    deviceKeyId,
  }
  return { ...base, sig: await signer.sign(workspaceInviteBytes(base)) }
}

function payloadShapeOk(value: Partial<WorkspaceInvitePayload>): value is WorkspaceInvitePayload {
  const invite = value.invite as Partial<WorkspaceInvite> | undefined
  const allowList = invite?.allowList
  return (
    value.v === 1 &&
    typeof value.inviteId === 'string' &&
    value.inviteId.length > 0 &&
    value.inviteId.length <= 64 &&
    typeof value.fromUserId === 'string' &&
    value.fromUserId.length > 0 &&
    value.fromUserId.length <= 256 &&
    typeof value.fromName === 'string' &&
    value.fromName.length <= MAX_NAME_LENGTH &&
    typeof value.toRendezvousId === 'string' &&
    RENDEZVOUS_CAPABILITY.test(value.toRendezvousId) &&
    typeof value.ts === 'number' &&
    Number.isFinite(value.ts) &&
    typeof value.deviceKeyId === 'string' &&
    value.deviceKeyId.length > 0 &&
    typeof value.sig === 'string' &&
    value.sig.length > 0 &&
    invite?.v === 1 &&
    typeof invite.workspaceId === 'string' &&
    invite.workspaceId.length >= 16 &&
    invite.workspaceId.length <= 128 &&
    (invite.workspaceRouteId === undefined || isWorkspaceRouteId(invite.workspaceRouteId)) &&
    typeof invite.workspaceName === 'string' &&
    invite.workspaceName.length > 0 &&
    invite.workspaceName.length <= MAX_WORKSPACE_NAME_LENGTH &&
    typeof invite.creatorKeyId === 'string' &&
    invite.creatorKeyId.length > 0 &&
    Array.isArray(allowList?.emails) &&
    allowList.emails.length > 0 &&
    allowList.emails.length <= MAX_MEMBERS &&
    allowList.emails.every(email => typeof email === 'string' && email.length <= 254) &&
    typeof allowList.signedAt === 'number' &&
    Number.isFinite(allowList.signedAt) &&
    typeof allowList.signature === 'string' &&
    allowList.signature.length > 0
  )
}

export function parseWorkspaceInvitePayload(raw: unknown): WorkspaceInvitePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<WorkspaceInvitePayload>
  if (!payloadShapeOk(value)) return null
  return value
}

export async function verifyWorkspaceInvite(payload: WorkspaceInvitePayload): Promise<boolean> {
  if (!payloadShapeOk(payload)) return false
  const age = Date.now() - payload.ts
  if (age > WORKSPACE_INVITE_TTL_MS || age < -MAX_CLOCK_SKEW_MS) return false
  if (payload.deviceKeyId !== payload.invite.creatorKeyId) return false
  if (!(await verifyAllowList(payload.invite.allowList, payload.invite.creatorKeyId, payload.invite.workspaceId))) {
    return false
  }
  return verifyWithDeviceKeyId(
    payload.deviceKeyId,
    workspaceInviteBytes(payload),
    payload.sig
  )
}

/** Recipient-side authorization check, kept separate from cryptographic validity. */
export function workspaceInviteAllowsEmail(
  payload: WorkspaceInvitePayload,
  email: string
): boolean {
  return isEmailAllowed(payload.invite.allowList, email)
}
