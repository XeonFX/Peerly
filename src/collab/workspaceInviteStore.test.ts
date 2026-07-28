import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceInvitePayload } from './workspaceInvite'
import {
  dismissIncomingWorkspaceInvite,
  isWorkspaceInviteDismissed,
  loadIncomingWorkspaceInvites,
  loadOutgoingWorkspaceInvites,
  upsertIncomingWorkspaceInvite,
  upsertOutgoingWorkspaceInvite,
} from './workspaceInviteStore'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

const payload = {
  v: 1,
  inviteId: 'invite-1',
  fromUserId: 'alice',
  fromName: 'Alice',
  toRendezvousId: 'AbCdEf0123456789_bob-opaque-capability-value',
  invite: {
    v: 1,
    workspaceId: '0123456789abcdef0123456789abcdef',
    workspaceName: 'Acme',
    creatorKeyId: 'P-256:x:y',
    allowList: { emails: ['bob@example.com'], signedAt: Date.now(), signature: 'sig' },
  },
  ts: Date.now(),
  deviceKeyId: 'P-256:x:y',
  sig: 'sig',
} satisfies WorkspaceInvitePayload

beforeEach(() => vi.stubGlobal('localStorage', createStorage()))
afterEach(() => vi.unstubAllGlobals())

describe('workspaceInviteStore', () => {
  it('replaces pending delivery for the same email and workspace', () => {
    let values = upsertOutgoingWorkspaceInvite(loadOutgoingWorkspaceInvites(), {
      inviteId: 'invite-1',
      toEmail: 'bob@example.com',
      toRendezvousId: payload.toRendezvousId,
      payload,
      createdAt: Date.now(),
      lastSentAt: 0,
    })
    values = upsertOutgoingWorkspaceInvite(values, {
      inviteId: 'invite-2',
      toEmail: 'Bob@example.com',
      toRendezvousId: payload.toRendezvousId,
      payload: { ...payload, inviteId: 'invite-2' },
      createdAt: Date.now(),
      lastSentAt: 0,
    })
    expect(values.map(value => value.inviteId)).toEqual(['invite-2'])
  })

  it('keeps the newest invitation per workspace and supports dismissing it', () => {
    const first = {
      inviteId: 'invite-1',
      fromUserId: 'alice',
      fromName: 'Alice',
      payload,
      receivedAt: Date.now(),
    }
    let values = upsertIncomingWorkspaceInvite(loadIncomingWorkspaceInvites(), first)
    values = upsertIncomingWorkspaceInvite(values, {
      ...first,
      inviteId: 'invite-2',
      payload: {
        ...payload,
        inviteId: 'invite-2',
        invite: {
          ...payload.invite,
          allowList: { ...payload.invite.allowList, signedAt: payload.invite.allowList.signedAt + 1 },
        },
      },
    })
    expect(values.map(value => value.inviteId)).toEqual(['invite-2'])
    expect(dismissIncomingWorkspaceInvite(values, 'invite-2')).toEqual([])
    expect(isWorkspaceInviteDismissed('invite-2')).toBe(true)
  })

  it('expires dismissal tombstones with the invitation lifetime', () => {
    dismissIncomingWorkspaceInvite([], 'invite-1', 1_000)
    expect(isWorkspaceInviteDismissed('invite-1', 1_001)).toBe(true)
    expect(isWorkspaceInviteDismissed('invite-1', 1_000 + 8 * 24 * 60 * 60 * 1000)).toBe(false)
  })
})
