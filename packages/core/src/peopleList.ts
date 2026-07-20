import { encodeCanonicalLines } from './canonical.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import { base64UrlToUtf8, utf8ToBase64Url } from './base64url.js'
import type { DeviceSigner } from './textChatSigning.js'

/**
 * Signed personal lists of people (block, friend, …) for serverless apps.
 *
 * Each entry is a device-key-signed
 * attestation about a subject `userId`, stored locally, optionally exported
 * as a shareable code. Apps own the scheme string and storage keys so wire
 * formats stay stable.
 *
 * Peerly friends may carry a verified `email` (from the workspace handshake)
 * so the creator can pre-fill workspace invites. Consumer apps may leave
 * email empty so strangers never exchange addresses.
 */

export type PeopleListKind = 'block' | 'friend'

export type PeopleAttestation = {
  kind: PeopleListKind
  /** Who created the attestation (claim tied to the signing device key). */
  ownerUserId: string
  /** Subject this entry is about. */
  subjectUserId: string
  /** Cached display name for management UI. */
  subjectName: string
  /**
   * Optional verified email (Peerly handshake). Never required by the
   * primitive — apps that lack it simply omit the field.
   */
  subjectEmail?: string
  /** Free-form category (e.g. block reason). Validated by the app if needed. */
  category?: string
  ts: number
  deviceKeyId: DeviceKeyId
  sig: string
}

export type PeopleSubscription = {
  id: string
  label: string
  addedAt: number
  entries: PeopleAttestation[]
}

export type PeopleList = {
  own: Map<string, PeopleAttestation>
  subscribed: PeopleSubscription[]
}

export type SharedPeopleList = {
  v: 1
  kind: PeopleListKind
  label: string
  createdAt: number
  entries: PeopleAttestation[]
}

const MAX_NAME = 80
const MAX_LABEL = 60
const MAX_EMAIL = 254
const MAX_CATEGORY = 40
const MAX_IMPORT_ENTRIES = 1_000

export function emptyPeopleList(): PeopleList {
  return { own: new Map(), subscribed: [] }
}

/**
 * Canonical signing bytes. Scheme is app-owned (e.g. `hh-block-v1`,
 * `peerly-friend-v1`). Free-text name last; fixed fields never contain `\n`.
 */
export function peopleAttestationBytes(
  scheme: string,
  entry: Omit<PeopleAttestation, 'sig'>
): Uint8Array {
  return encodeCanonicalLines([
    scheme,
    entry.kind,
    entry.ownerUserId,
    entry.subjectUserId,
    entry.deviceKeyId,
    String(entry.ts),
    entry.category ?? '',
    entry.subjectEmail ?? '',
    entry.subjectName,
  ])
}

function shapeOk(kind: PeopleListKind, entry: PeopleAttestation): boolean {
  return (
    !!entry &&
    typeof entry === 'object' &&
    entry.kind === kind &&
    typeof entry.ownerUserId === 'string' &&
    !!entry.ownerUserId &&
    typeof entry.subjectUserId === 'string' &&
    !!entry.subjectUserId &&
    typeof entry.subjectName === 'string' &&
    entry.subjectName.length <= MAX_NAME &&
    typeof entry.ts === 'number' &&
    typeof entry.deviceKeyId === 'string' &&
    typeof entry.sig === 'string' &&
    (entry.subjectEmail === undefined ||
      (typeof entry.subjectEmail === 'string' &&
        entry.subjectEmail.length <= MAX_EMAIL &&
        entry.subjectEmail.includes('@'))) &&
    (entry.category === undefined ||
      (typeof entry.category === 'string' && entry.category.length <= MAX_CATEGORY))
  )
}

export async function verifyPeopleAttestation(
  scheme: string,
  kind: PeopleListKind,
  entry: PeopleAttestation
): Promise<boolean> {
  if (!shapeOk(kind, entry)) return false
  return verifyWithDeviceKeyId(entry.deviceKeyId, peopleAttestationBytes(scheme, entry), entry.sig)
}

export async function createPeopleAttestation(
  signer: DeviceSigner,
  scheme: string,
  input: {
    kind: PeopleListKind
    ownerUserId: string
    subjectUserId: string
    subjectName: string
    subjectEmail?: string
    category?: string
  }
): Promise<PeopleAttestation> {
  const base: Omit<PeopleAttestation, 'sig'> = {
    kind: input.kind,
    ownerUserId: input.ownerUserId,
    subjectUserId: input.subjectUserId,
    subjectName: input.subjectName.slice(0, MAX_NAME),
    ts: Date.now(),
    deviceKeyId: await signer.publicKeyId(),
    ...(input.subjectEmail
      ? { subjectEmail: input.subjectEmail.trim().toLowerCase().slice(0, MAX_EMAIL) }
      : {}),
    ...(input.category ? { category: input.category.slice(0, MAX_CATEGORY) } : {}),
  }
  const sig = await signer.sign(peopleAttestationBytes(scheme, base))
  return { ...base, sig }
}

export function effectiveSubjectUserIds(list: PeopleList): Set<string> {
  const ids = new Set(list.own.keys())
  for (const sub of list.subscribed) {
    for (const entry of sub.entries) ids.add(entry.subjectUserId)
  }
  return ids
}

export function isSubjectListed(list: PeopleList, userId: string | undefined): boolean {
  if (!userId) return false
  if (list.own.has(userId)) return true
  return list.subscribed.some(sub => sub.entries.some(entry => entry.subjectUserId === userId))
}

export function ownEntriesNewestFirst(list: PeopleList): PeopleAttestation[] {
  return [...list.own.values()].sort((a, b) => b.ts - a.ts)
}

export function addPeopleEntry(list: PeopleList, entry: PeopleAttestation): void {
  list.own.set(entry.subjectUserId, entry)
}

export function removePeopleEntry(list: PeopleList, subjectUserId: string): boolean {
  return list.own.delete(subjectUserId)
}

export function loadPeopleList(storageKey: string, subsKey: string): PeopleList {
  const list = emptyPeopleList()
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const entries = JSON.parse(raw) as PeopleAttestation[]
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry && typeof entry.subjectUserId === 'string' && entry.subjectUserId) {
            list.own.set(entry.subjectUserId, entry)
          }
        }
      }
    }
  } catch {
    // corrupted — start empty
  }
  try {
    const raw = localStorage.getItem(subsKey)
    if (raw) {
      const subs = JSON.parse(raw) as PeopleSubscription[]
      if (Array.isArray(subs)) {
        for (const sub of subs) {
          if (sub && typeof sub.id === 'string' && Array.isArray(sub.entries)) {
            list.subscribed.push(sub)
          }
        }
      }
    }
  } catch {
    // drop bad subscriptions only
  }
  return list
}

export function savePeopleList(list: PeopleList, storageKey: string, subsKey: string): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...list.own.values()]))
    localStorage.setItem(subsKey, JSON.stringify(list.subscribed))
  } catch {
    // storage full — list is local-only; losing it is recoverable by re-adding
  }
}

export function encodeSharedPeopleList(
  kind: PeopleListKind,
  label: string,
  entries: PeopleAttestation[]
): string {
  const payload: SharedPeopleList = {
    v: 1,
    kind,
    label: label.slice(0, MAX_LABEL),
    createdAt: Date.now(),
    entries,
  }
  return utf8ToBase64Url(JSON.stringify(payload))
}

export function decodeSharedPeopleList(code: string): SharedPeopleList | null {
  try {
    const parsed = JSON.parse(base64UrlToUtf8(code.trim())) as Partial<SharedPeopleList>
    if (
      parsed.v !== 1 ||
      (parsed.kind !== 'block' && parsed.kind !== 'friend') ||
      typeof parsed.label !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      !Array.isArray(parsed.entries)
    ) {
      return null
    }
    return parsed as SharedPeopleList
  } catch {
    return null
  }
}

export async function verifySharedPeopleList(
  scheme: string,
  kind: PeopleListKind,
  shared: SharedPeopleList,
  selfUserId: string
): Promise<PeopleSubscription | null> {
  if (shared.kind !== kind) return null
  const seen = new Set<string>()
  const entries: PeopleAttestation[] = []
  for (const entry of shared.entries.slice(0, MAX_IMPORT_ENTRIES)) {
    if (entry?.subjectUserId === selfUserId) continue
    if (seen.has(entry?.subjectUserId)) continue
    if (await verifyPeopleAttestation(scheme, kind, entry)) {
      seen.add(entry.subjectUserId)
      entries.push(entry)
    }
  }
  if (entries.length === 0) return null
  return {
    id: crypto.randomUUID(),
    label: shared.label.slice(0, MAX_LABEL) || 'Imported list',
    addedAt: Date.now(),
    entries,
  }
}

export function addPeopleSubscription(list: PeopleList, sub: PeopleSubscription): void {
  list.subscribed.push(sub)
}

export function removePeopleSubscription(list: PeopleList, id: string): boolean {
  const before = list.subscribed.length
  list.subscribed = list.subscribed.filter(sub => sub.id !== id)
  return list.subscribed.length !== before
}
