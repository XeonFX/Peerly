import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSessionFromInvite,
  leaveWorkspace,
  loadIdentityProvider,
  loadPersistedSession,
  loadSession,
  saveIdCredentials,
  saveSession,
} from './session'

const PERSIST_KEY = 'peerly-session'
const ID_TOKEN_KEY = 'peerly-id-token'

const TEST_INVITE = {
  workspaceId: 'abc123workspaceid000000000001',
  workspaceName: 'My Team',
  creatorKeyId: 'P-256:x:y',
  allowList: { emails: ['alice@example.com'], signedAt: 1, signature: 'sig' },
}

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage())
  vi.stubGlobal('sessionStorage', createStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('session persistence', () => {
  it('leaveWorkspace keeps profile but clears id credentials', () => {
    const session = createSessionFromInvite(TEST_INVITE, 'alice@example.com', 'google')
    saveSession(session)
    saveIdCredentials('token-1', 'google')

    leaveWorkspace()

    expect(loadSession()).toBeNull()
    expect(loadPersistedSession()).toEqual({
      workspaceId: TEST_INVITE.workspaceId,
      workspaceName: TEST_INVITE.workspaceName,
      creatorKeyId: TEST_INVITE.creatorKeyId,
      allowList: TEST_INVITE.allowList,
      identityEmail: 'alice@example.com',
      identityProvider: 'google',
      userName: 'alice',
      color: expect.any(String),
      avatarId: undefined,
    })
    expect(sessionStorage.getItem(ID_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(PERSIST_KEY)).not.toBeNull()
  })

  it('createSessionFromInvite reuses saved profile on rejoin', () => {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        workspaceId: 'old',
        workspaceName: 'Old',
        creatorKeyId: 'P-256:a:b',
        allowList: TEST_INVITE.allowList,
        identityEmail: 'bob@example.com',
        identityProvider: 'microsoft',
        userName: 'Bob',
        color: '#2eb67d',
        avatarId: 'avatar-9',
      })
    )

    const session = createSessionFromInvite(TEST_INVITE, 'alice@example.com', 'google')

    expect(session.userName).toBe('Bob')
    expect(session.color).toBe('#2eb67d')
    expect(session.avatarId).toBe('avatar-9')
    expect(session.workspaceId).toBe(TEST_INVITE.workspaceId)
    expect(session.identityEmail).toBe('alice@example.com')
    expect(session.identityProvider).toBe('google')
  })

  it('loadSession restores after save when id token is present', () => {
    const session = createSessionFromInvite(TEST_INVITE, 'alice@e2e.test', 'google')
    saveSession(session)
    saveIdCredentials('test-id-token', 'google')

    expect(loadSession()).toEqual({
      workspaceId: TEST_INVITE.workspaceId,
      workspaceName: TEST_INVITE.workspaceName,
      creatorKeyId: TEST_INVITE.creatorKeyId,
      allowList: TEST_INVITE.allowList,
      identityEmail: 'alice@e2e.test',
      identityProvider: 'google',
      userName: 'alice',
      color: expect.any(String),
      avatarId: undefined,
    })
    expect(loadIdentityProvider()).toBe('google')
  })
})