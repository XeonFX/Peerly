import { INVITE_TTL_MS, type FriendInvitePayload } from './friendInvite'
import { normalizeEmail } from './emailHash'

/**
 * Device-local pending friend invites (outgoing typed emails + incoming signed
 * envelopes). Not gossiped — only the live lobby wire delivers them.
 */

const OUT_KEY = 'peerly-friend-invites-out-v2'
const IN_KEY = 'peerly-friend-invites-in-v2'
const LEGACY_KEYS = ['peerly-friend-invites-out-v1', 'peerly-friend-invites-in-v1']

export type OutgoingFriendInvite = {
  inviteId: string
  toEmail: string
  /** Opaque Worker-issued lookup capability; never derived from email in the browser. */
  toRendezvousId: string
  /** Full signed payload ready to re-send when the peer appears. */
  payload: FriendInvitePayload
  createdAt: number
  /** Last successful directed send (0 = never delivered yet). */
  lastSentAt: number
}

export type IncomingFriendInvite = {
  inviteId: string
  fromUserId: string
  fromName: string
  payload: FriendInvitePayload
  receivedAt: number
}

function readArray<T>(key: string): T[] {
  try {
    for (const legacyKey of LEGACY_KEYS) localStorage.removeItem(legacyKey)
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // Quota — invites are best-effort.
  }
}

function notExpired(ts: number, now: number): boolean {
  return now - ts <= INVITE_TTL_MS
}

export function loadOutgoingInvites(now = Date.now()): OutgoingFriendInvite[] {
  const items = readArray<OutgoingFriendInvite>(OUT_KEY).filter(
    item =>
      item &&
      typeof item.inviteId === 'string' &&
      typeof item.toEmail === 'string' &&
      typeof item.toRendezvousId === 'string' &&
      item.payload &&
      notExpired(item.createdAt, now)
  )
  writeArray(OUT_KEY, items)
  return items
}

export function loadIncomingInvites(now = Date.now()): IncomingFriendInvite[] {
  const items = readArray<IncomingFriendInvite>(IN_KEY).filter(
    item =>
      item &&
      typeof item.inviteId === 'string' &&
      typeof item.fromUserId === 'string' &&
      item.payload &&
      notExpired(item.receivedAt, now)
  )
  writeArray(IN_KEY, items)
  return items
}

export function saveOutgoingInvites(items: OutgoingFriendInvite[]): void {
  writeArray(OUT_KEY, items)
}

export function saveIncomingInvites(items: IncomingFriendInvite[]): void {
  writeArray(IN_KEY, items)
}

export function upsertOutgoingInvite(
  items: OutgoingFriendInvite[],
  entry: OutgoingFriendInvite
): OutgoingFriendInvite[] {
  const next = items.filter(
    i => i.inviteId !== entry.inviteId && normalizeEmail(i.toEmail) !== normalizeEmail(entry.toEmail)
  )
  next.unshift(entry)
  saveOutgoingInvites(next)
  return next
}

export function removeOutgoingInvite(
  items: OutgoingFriendInvite[],
  inviteId: string
): OutgoingFriendInvite[] {
  const next = items.filter(i => i.inviteId !== inviteId)
  if (next.length !== items.length) saveOutgoingInvites(next)
  return next
}

export function removeOutgoingByEmail(
  items: OutgoingFriendInvite[],
  email: string
): OutgoingFriendInvite[] {
  const target = normalizeEmail(email)
  const next = items.filter(i => normalizeEmail(i.toEmail) !== target)
  if (next.length !== items.length) saveOutgoingInvites(next)
  return next
}

export function upsertIncomingInvite(
  items: IncomingFriendInvite[],
  entry: IncomingFriendInvite
): IncomingFriendInvite[] {
  if (items.some(i => i.inviteId === entry.inviteId)) return items
  const next = [entry, ...items.filter(i => i.fromUserId !== entry.fromUserId)]
  saveIncomingInvites(next)
  return next
}

export function removeIncomingInvite(
  items: IncomingFriendInvite[],
  inviteId: string
): IncomingFriendInvite[] {
  const next = items.filter(i => i.inviteId !== inviteId)
  if (next.length !== items.length) saveIncomingInvites(next)
  return next
}
