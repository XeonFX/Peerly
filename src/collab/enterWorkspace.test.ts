/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { persistWorkspaceSession } from './enterWorkspace'
import { loadWorkspaces } from './workspaceStore'
import { loadIdentityEmail, loadPersistedSession, type StoredIdentity } from '../session'
import type { DeviceKeyId } from './deviceIdentity'

const access = {
  workspaceId: 'ws-secret-123',
  workspaceName: 'Test WS',
  creatorKeyId: 'P-256:abc:def' as DeviceKeyId,
  allowList: { emails: ['a@b.com'], signedAt: 1, signature: 'sig' },
}

const identity: StoredIdentity = {
  email: 'a@b.com',
  token: 'tok',
  providerId: 'google',
  userId: 'uid-1',
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('persistWorkspaceSession', () => {
  it('persists the session, credentials, and remembers the workspace', () => {
    const session = persistWorkspaceSession(access, identity, 'Alice')

    expect(session.workspaceId).toBe('ws-secret-123')
    expect(session.identityEmail).toBe('a@b.com')
    // Reads back from storage — this is what App/JoinScreen rely on.
    expect(loadPersistedSession()?.workspaceId).toBe('ws-secret-123')
    expect(loadIdentityEmail()).toBe('a@b.com')
    expect(loadWorkspaces().some(w => w.workspaceId === 'ws-secret-123')).toBe(true)
  })

  it('uses the display name only as a fallback for a fresh profile', () => {
    const session = persistWorkspaceSession(access, identity, 'Alice')
    expect(session.userName).toBe('Alice')
  })
})
