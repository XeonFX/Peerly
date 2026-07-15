import type { DeviceIdentity, DeviceKeyId } from './deviceIdentity'
import { verifyWithDeviceKeyId } from './deviceIdentity'

export type SignedAllowList = {
  emails: string[]
  signedAt: number
  signature: string
}

function canonicalizeEmails(emails: string[]): string[] {
  const cleaned = emails
    .map(email => email.trim().toLowerCase())
    .filter(email => email.length > 0 && email.includes('@'))
  return [...new Set(cleaned)].sort()
}

/**
 * The exact bytes a signature covers. Deliberately not JSON.stringify(list) —
 * key order in an object isn't part of its semantic content, so signing JSON
 * text directly would make the signature depend on incidental serialization
 * details instead of the data. This is fixed and unambiguous.
 */
function canonicalPayload(emails: string[], signedAt: number): Uint8Array {
  return new TextEncoder().encode(`${canonicalizeEmails(emails).join(',')}|${signedAt}`)
}

/** Creator signs the workspace's membership list with their device key. */
export async function signAllowList(
  identity: DeviceIdentity,
  emails: string[]
): Promise<SignedAllowList> {
  const canonicalEmails = canonicalizeEmails(emails)
  const signedAt = Date.now()
  const signature = await identity.sign(canonicalPayload(canonicalEmails, signedAt))
  return { emails: canonicalEmails, signedAt, signature }
}

/**
 * True only if the list is validly signed by the given creator key. Every peer
 * runs this on every allow-list it's handed — from an invite link or from
 * another peer relaying an update — before ever treating it as authoritative.
 */
export async function verifyAllowList(
  list: SignedAllowList,
  creatorKeyId: DeviceKeyId
): Promise<boolean> {
  if (!Array.isArray(list.emails) || typeof list.signedAt !== 'number' || !list.signature) {
    return false
  }
  return verifyWithDeviceKeyId(
    creatorKeyId,
    canonicalPayload(list.emails, list.signedAt),
    list.signature
  )
}

export function isEmailAllowed(list: SignedAllowList, email: string): boolean {
  const normalized = email.trim().toLowerCase()
  return list.emails.includes(normalized)
}

/**
 * Reconcile two allow-lists a peer has seen for the same workspace: the newer
 * signed one wins. Callers must verify BOTH lists against the creator key
 * before calling this — it does not verify, only compares, so a signature
 * check can't be skipped by routing through here.
 */
export function newerAllowList(a: SignedAllowList, b: SignedAllowList): SignedAllowList {
  return b.signedAt > a.signedAt ? b : a
}
