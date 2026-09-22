import { describe, expect, it } from 'vitest'
import type { KvStore } from '../utils/kvStore'
import { DeviceIdentity } from './deviceIdentity'
import { signAllowList } from './allowList'
import {
  createWorkspaceInvite,
  parseWorkspaceInvitePayload,
  verifyWorkspaceInvite,
  workspaceInviteAllowsEmail,
} from './workspaceInvite'
import type { WorkspaceInvite } from './inviteLink'

function memoryStore(): KvStore<CryptoKeyPair> {
  const values = new Map<string, CryptoKeyPair>()
  return {
    async get(key) { return values.get(key) ?? null },
    async set(key, value) { values.set(key, value) },
  }
}

describe('workspace invitation envelope', () => {
  it('binds the target and workspace invite to the creator key', async () => {
    const creator = new DeviceIdentity(memoryStore())
    const creatorKeyId = await creator.publicKeyId()
    const invite: WorkspaceInvite = {
      v: 1,
      workspaceId: '0123456789abcdef0123456789abcdef',
      workspaceName: 'Acme',
      creatorKeyId,
      allowList: await signAllowList(creator, ['alice@example.com', 'bob@example.com']),
    }
    const payload = await createWorkspaceInvite(creator, {
      inviteId: 'workspace-invite-1',
      fromUserId: 'alice',
      fromName: 'Alice',
      toRendezvousId: 'AbCdEf0123456789_bob-opaque-capability-value',
      invite,
    })

    expect(parseWorkspaceInvitePayload(payload)).toEqual(payload)
    expect(await verifyWorkspaceInvite(payload)).toBe(true)
    expect(workspaceInviteAllowsEmail(payload, 'Bob@example.com')).toBe(true)
    expect(await verifyWorkspaceInvite({
      ...payload,
      invite: { ...invite, workspaceName: 'Forged' },
    })).toBe(false)
  })

  it('rejects delivery signed by a non-creator device', async () => {
    const creator = new DeviceIdentity(memoryStore())
    const other = new DeviceIdentity(memoryStore())
    const invite: WorkspaceInvite = {
      v: 1,
      workspaceId: '0123456789abcdef0123456789abcdef',
      workspaceName: 'Acme',
      creatorKeyId: await creator.publicKeyId(),
      allowList: await signAllowList(creator, ['bob@example.com']),
    }

    await expect(createWorkspaceInvite(other, {
      inviteId: 'workspace-invite-2',
      fromUserId: 'mallory',
      fromName: 'Mallory',
      toRendezvousId: 'AbCdEf0123456789_bob-opaque-capability-value',
      invite,
    })).rejects.toThrow(/creator/)
  })
})
