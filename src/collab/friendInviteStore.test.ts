import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FriendInvitePayload } from './friendInvite'
import {
  loadIncomingInvites,
  loadOutgoingInvites,
  removeIncomingInvite,
  removeOutgoingInvite,
  upsertIncomingInvite,
  upsertOutgoingInvite,
} from './friendInviteStore'

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

const payload = {
  v: 1 as const,
  inviteId: 'inv-1',
  fromUserId: 'alice',
  fromName: 'Alice',
  fromEmail: 'alice@example.com',
  fromEmailHash: 'a'.repeat(64),
  toEmailHash: 'b'.repeat(64),
  dmSecret: '0123456789abcdef0123456789abcdef',
  ts: Date.now(),
  deviceKeyId: 'P-256:x:y',
  sig: 'sig',
} satisfies FriendInvitePayload

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('friendInviteStore', () => {
  it('persists outgoing invites and replaces by email', () => {
    let out = loadOutgoingInvites()
    out = upsertOutgoingInvite(out, {
      inviteId: 'inv-1',
      toEmail: 'bob@example.com',
      toEmailHash: 'b'.repeat(64),
      payload,
      createdAt: Date.now(),
      lastSentAt: 0,
    })
    out = upsertOutgoingInvite(out, {
      inviteId: 'inv-2',
      toEmail: 'Bob@example.com',
      toEmailHash: 'b'.repeat(64),
      payload: { ...payload, inviteId: 'inv-2' },
      createdAt: Date.now(),
      lastSentAt: 0,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.inviteId).toBe('inv-2')
    expect(loadOutgoingInvites()).toHaveLength(1)
    out = removeOutgoingInvite(out, 'inv-2')
    expect(out).toHaveLength(0)
  })

  it('persists incoming invites and dedupes by inviteId', () => {
    let inn = loadIncomingInvites()
    const entry = {
      inviteId: 'inv-1',
      fromUserId: 'alice',
      fromName: 'Alice',
      fromEmailHash: 'a'.repeat(64),
      payload,
      receivedAt: Date.now(),
    }
    inn = upsertIncomingInvite(inn, entry)
    inn = upsertIncomingInvite(inn, entry)
    expect(inn).toHaveLength(1)
    inn = removeIncomingInvite(inn, 'inv-1')
    expect(inn).toHaveLength(0)
  })
})
