import { base64UrlToUtf8, utf8ToBase64Url } from '../utils/base64url'
import type { DeviceKeyId } from './deviceIdentity'
import type { SignedAllowList } from './allowList'

const INVITE_PARAM = 'invite'

export type WorkspaceInvite = {
  v: 1
  /** Random, high-entropy — this doubles as the Trystero room password. */
  workspaceId: string
  workspaceName: string
  creatorKeyId: DeviceKeyId
  allowList: SignedAllowList
}

/**
 * Generate the workspace's addressable, secret identity. Not slugified from
 * the display name — two workspaces named "my-team" must never collide, and
 * this being unguessable is what makes the workspace-id-as-password model
 * (see useRoom.ts) meaningful. 128 bits, lowercase hex: safe as a room id, a
 * Trystero password, and a localStorage key segment with no escaping.
 */
export function generateWorkspaceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Everything here goes in the URL *fragment* (`#...`), not the query string or
 * path. Fragments are never sent in the HTTP request — not to a server, not
 * into access logs — which matters because this payload contains the
 * workspace's secret and the creator's signed membership list. A static host
 * serves the same index.html regardless of the fragment; the app reads it from
 * `location.hash` after load.
 */
export function encodeInviteLink(invite: WorkspaceInvite, origin: string = location.origin): string {
  const encoded = utf8ToBase64Url(JSON.stringify(invite))
  return `${origin}/#${INVITE_PARAM}=${encoded}`
}

/**
 * Parse an invite out of a URL hash. Returns null for anything malformed
 * rather than throwing — an invalid or edited-by-hand link should look like
 * "no invite here," not crash the app. This only checks *shape*; the caller
 * (identityHandshake / the join screen) is responsible for verifying the
 * allow-list's signature against `creatorKeyId` before trusting its contents.
 */
export function decodeInviteFromHash(hash: string): WorkspaceInvite | null {
  const match = /^#?invite=(.+)$/.exec(hash)
  if (!match) return null

  try {
    const parsed = JSON.parse(base64UrlToUtf8(match[1])) as Partial<WorkspaceInvite>
    if (
      parsed.v !== 1 ||
      typeof parsed.workspaceId !== 'string' ||
      !parsed.workspaceId ||
      typeof parsed.workspaceName !== 'string' ||
      typeof parsed.creatorKeyId !== 'string' ||
      !parsed.allowList ||
      !Array.isArray(parsed.allowList.emails) ||
      typeof parsed.allowList.signedAt !== 'number' ||
      typeof parsed.allowList.signature !== 'string'
    ) {
      return null
    }
    return parsed as WorkspaceInvite
  } catch {
    return null
  }
}
