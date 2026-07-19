import { isEmailAllowed } from './allowList'
import type { WorkspaceAccess } from './inviteLink'
import { verifyInviteAllowList } from './workspaceAuth'
import { rememberWorkspace, snapshotWorkspace, type StoredWorkspace } from './workspaceStore'
import {
  createSessionFromInvite,
  saveIdCredentials,
  saveSession,
  type Session,
  type StoredIdentity,
} from '../session'

/**
 * Build and persist an active session for a workspace the caller has already
 * verified. This is the shared core of joining via invite, opening a remembered
 * workspace from the picker, and switching workspaces in place from the rail —
 * so all three write the session, credentials, and remembered-workspaces list
 * identically. It does NOT verify the allow-list signature or membership; use
 * enterStoredWorkspace() when those still need checking.
 */
export function persistWorkspaceSession(
  access: WorkspaceAccess & { workspaceAvatarId?: string },
  identity: StoredIdentity,
  displayName?: string
): Session {
  saveIdCredentials(identity.token, identity.providerId, identity.email, identity.userId)
  const session = createSessionFromInvite(
    access,
    identity.email,
    identity.providerId,
    displayName,
    identity.userId
  )
  saveSession(session)
  // Remember it so the next sign-in offers it without the invite link.
  rememberWorkspace(
    snapshotWorkspace({
      workspaceId: access.workspaceId,
      workspaceName: access.workspaceName,
      creatorKeyId: access.creatorKeyId,
      allowList: access.allowList,
      workspaceAvatarId: access.workspaceAvatarId,
    })
  )
  return session
}

/** Why entering a stored workspace failed — callers map to localized copy. */
export type WorkspaceEntryFailure = 'invalid-signature' | 'not-allowed'

export class WorkspaceEntryError extends Error {
  constructor(public readonly reason: WorkspaceEntryFailure) {
    super(reason)
    this.name = 'WorkspaceEntryError'
  }
}

/**
 * Verify a remembered workspace, then enter it in place (rail switch). Re-runs
 * the same signature + membership checks the invite path does rather than
 * trusting localStorage; peers re-verify regardless, but failing here yields a
 * comprehensible error instead of a silent handshake denial.
 */
export async function enterStoredWorkspace(
  workspace: StoredWorkspace,
  identity: StoredIdentity
): Promise<Session> {
  if (!(await verifyInviteAllowList(workspace))) {
    throw new WorkspaceEntryError('invalid-signature')
  }
  if (!isEmailAllowed(workspace.allowList, identity.email)) {
    throw new WorkspaceEntryError('not-allowed')
  }
  return persistWorkspaceSession(workspace, identity)
}
