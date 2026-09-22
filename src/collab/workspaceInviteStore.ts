import {
  WORKSPACE_INVITE_TTL_MS,
  type WorkspaceInvitePayload,
} from './workspaceInvite'
import { normalizeEmail } from './emailHash'

const OUT_KEY = 'peerly-workspace-invites-out-v1'
const IN_KEY = 'peerly-workspace-invites-in-v1'
const DISMISSED_KEY = 'peerly-workspace-invites-dismissed-v1'

export type OutgoingWorkspaceInvite = {
  inviteId: string
  toEmail: string
  toRendezvousId: string
  payload: WorkspaceInvitePayload
  createdAt: number
  lastSentAt: number
}

export type IncomingWorkspaceInvite = {
  inviteId: string
  fromUserId: string
  fromName: string
  payload: WorkspaceInvitePayload
  receivedAt: number
}

type DismissedWorkspaceInvite = {
  inviteId: string
  dismissedAt: number
}

function readArray<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, values: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values))
  } catch {
    // Delivery is best-effort; the copyable invite link remains available.
  }
}

function current(timestamp: number, now: number): boolean {
  return Number.isFinite(timestamp) && now - timestamp <= WORKSPACE_INVITE_TTL_MS
}

function loadDismissedWorkspaceInvites(now = Date.now()): DismissedWorkspaceInvite[] {
  const values = readArray<DismissedWorkspaceInvite>(DISMISSED_KEY).filter(value =>
    value
    && typeof value.inviteId === 'string'
    && current(value.dismissedAt, now)
  )
  writeArray(DISMISSED_KEY, values)
  return values
}

export function isWorkspaceInviteDismissed(inviteId: string, now = Date.now()): boolean {
  return loadDismissedWorkspaceInvites(now).some(value => value.inviteId === inviteId)
}

export function loadOutgoingWorkspaceInvites(now = Date.now()): OutgoingWorkspaceInvite[] {
  const values = readArray<OutgoingWorkspaceInvite>(OUT_KEY).filter(value =>
    value &&
    typeof value.inviteId === 'string' &&
    typeof value.toEmail === 'string' &&
    typeof value.toRendezvousId === 'string' &&
    Boolean(value.payload) &&
    current(value.createdAt, now)
  )
  writeArray(OUT_KEY, values)
  return values
}

export function loadIncomingWorkspaceInvites(now = Date.now()): IncomingWorkspaceInvite[] {
  const values = readArray<IncomingWorkspaceInvite>(IN_KEY).filter(value =>
    value &&
    typeof value.inviteId === 'string' &&
    typeof value.fromUserId === 'string' &&
    Boolean(value.payload) &&
    current(value.receivedAt, now)
  )
  writeArray(IN_KEY, values)
  return values
}

export function saveOutgoingWorkspaceInvites(values: OutgoingWorkspaceInvite[]): void {
  writeArray(OUT_KEY, values)
}

export function upsertOutgoingWorkspaceInvite(
  values: OutgoingWorkspaceInvite[],
  entry: OutgoingWorkspaceInvite
): OutgoingWorkspaceInvite[] {
  const email = normalizeEmail(entry.toEmail)
  const workspaceId = entry.payload.invite.workspaceId
  const next = [
    entry,
    ...values.filter(value =>
      value.inviteId !== entry.inviteId &&
      !(normalizeEmail(value.toEmail) === email && value.payload.invite.workspaceId === workspaceId)
    ),
  ]
  saveOutgoingWorkspaceInvites(next)
  return next
}

export function upsertIncomingWorkspaceInvite(
  values: IncomingWorkspaceInvite[],
  entry: IncomingWorkspaceInvite
): IncomingWorkspaceInvite[] {
  const workspaceId = entry.payload.invite.workspaceId
  const existing = values.find(value => value.payload.invite.workspaceId === workspaceId)
  if (existing && existing.payload.invite.allowList.signedAt >= entry.payload.invite.allowList.signedAt) {
    return values
  }
  const next = [entry, ...values.filter(value => value.payload.invite.workspaceId !== workspaceId)]
  writeArray(IN_KEY, next)
  return next
}

export function removeIncomingWorkspaceInvite(
  values: IncomingWorkspaceInvite[],
  inviteId: string
): IncomingWorkspaceInvite[] {
  const next = values.filter(value => value.inviteId !== inviteId)
  if (next.length !== values.length) writeArray(IN_KEY, next)
  return next
}

/**
 * Remove an invitation and remember the decision for its delivery lifetime.
 * Senders retry while online, so a plain removal would make a joined or
 * dismissed invitation reappear every few seconds.
 */
export function dismissIncomingWorkspaceInvite(
  values: IncomingWorkspaceInvite[],
  inviteId: string,
  now = Date.now()
): IncomingWorkspaceInvite[] {
  const dismissed = loadDismissedWorkspaceInvites(now)
  if (!dismissed.some(value => value.inviteId === inviteId)) {
    writeArray(DISMISSED_KEY, [{ inviteId, dismissedAt: now }, ...dismissed])
  }
  return removeIncomingWorkspaceInvite(values, inviteId)
}
