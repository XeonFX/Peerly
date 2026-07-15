import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetWorkspace,
  loadWorkspaces,
  rememberWorkspace,
  workspacesForEmail,
} from './workspaceStore'

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

const listWith = (emails: string[], signedAt = 1_000) => ({
  emails,
  signedAt,
  signature: `sig-${signedAt}`,
})

const workspace = (id: string, emails: string[], signedAt = 1_000) => ({
  workspaceId: id,
  workspaceName: `WS ${id}`,
  creatorKeyId: 'P-256:x:y',
  allowList: listWith(emails, signedAt),
})

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspaceStore', () => {
  it('remembers a workspace and returns it', () => {
    rememberWorkspace(workspace('ws1', ['alice@example.com']))

    const all = loadWorkspaces()
    expect(all).toHaveLength(1)
    expect(all[0].workspaceId).toBe('ws1')
    expect(all[0].lastOpenedAt).toBeGreaterThan(0)
  })

  it('does not duplicate a workspace that is re-joined', () => {
    rememberWorkspace(workspace('ws1', ['alice@example.com']))
    rememberWorkspace(workspace('ws1', ['alice@example.com']))

    expect(loadWorkspaces()).toHaveLength(1)
  })

  it('orders most recently opened first', () => {
    rememberWorkspace(workspace('old', ['alice@example.com']))
    rememberWorkspace(workspace('new', ['alice@example.com']))

    expect(loadWorkspaces().map(w => w.workspaceId)).toEqual(['new', 'old'])
  })

  // Members get added over time. Pinning the list from the day you joined would
  // keep handing a stale one to the handshake and to new invite links.
  it('keeps the newer allow-list when re-remembering a workspace', () => {
    rememberWorkspace(workspace('ws1', ['alice@example.com'], 1_000))
    rememberWorkspace(workspace('ws1', ['alice@example.com', 'bob@example.com'], 2_000))

    const stored = loadWorkspaces()[0]
    expect(stored.allowList.signedAt).toBe(2_000)
    expect(stored.allowList.emails).toContain('bob@example.com')
  })

  it('does not let an older allow-list overwrite a newer one', () => {
    rememberWorkspace(workspace('ws1', ['alice@example.com', 'bob@example.com'], 2_000))
    rememberWorkspace(workspace('ws1', ['alice@example.com'], 1_000))

    const stored = loadWorkspaces()[0]
    expect(stored.allowList.signedAt).toBe(2_000)
    expect(stored.allowList.emails).toContain('bob@example.com')
  })

  it('forgets a workspace', () => {
    rememberWorkspace(workspace('ws1', ['alice@example.com']))
    rememberWorkspace(workspace('ws2', ['alice@example.com']))

    forgetWorkspace('ws1')

    expect(loadWorkspaces().map(w => w.workspaceId)).toEqual(['ws2'])
  })

  it('only offers workspaces the signed-in email is allowed into', () => {
    rememberWorkspace(workspace('alice-ws', ['alice@example.com']))
    rememberWorkspace(workspace('shared-ws', ['alice@example.com', 'bob@example.com']))

    expect(workspacesForEmail('bob@example.com').map(w => w.workspaceId)).toEqual(['shared-ws'])
    expect(workspacesForEmail('nobody@example.com')).toEqual([])
  })

  it('matches the allowed email case-insensitively', () => {
    rememberWorkspace(workspace('ws1', ['alice@example.com']))

    expect(workspacesForEmail('Alice@Example.com')).toHaveLength(1)
  })

  it('survives corrupt storage rather than breaking the join screen', () => {
    localStorage.setItem('peerly-workspaces', 'not json at all')
    expect(loadWorkspaces()).toEqual([])

    localStorage.setItem('peerly-workspaces', JSON.stringify({ not: 'an array' }))
    expect(loadWorkspaces()).toEqual([])
  })

  it('drops malformed entries but keeps valid ones', () => {
    localStorage.setItem(
      'peerly-workspaces',
      JSON.stringify([
        { workspaceId: 'broken' },
        { ...workspace('good', ['alice@example.com']), lastOpenedAt: 5 },
      ])
    )

    expect(loadWorkspaces().map(w => w.workspaceId)).toEqual(['good'])
  })
})
