import { describe, expect, it } from 'vitest'
import { verifyAllowList } from './allowList'
import { DeviceIdentity } from './deviceIdentity'
import { WorkspaceAuthManager } from './workspaceAuth'

/**
 * WorkspaceAuthManager builds its own DeviceIdentity against real IndexedDB,
 * which the node test env lacks. Every test here needs two *different* devices
 * (creator vs. someone else), so swap in in-memory identities.
 */
function withIdentity(manager: WorkspaceAuthManager, identity: DeviceIdentity): WorkspaceAuthManager {
  ;(manager as unknown as { identity: DeviceIdentity }).identity = identity
  return manager
}

function memoryIdentity(): DeviceIdentity {
  const map = new Map<string, CryptoKeyPair>()
  return new DeviceIdentity({
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
  })
}

async function creatorSetup() {
  const creator = memoryIdentity()
  const creatorKeyId = await creator.publicKeyId()
  const manager = withIdentity(
    new WorkspaceAuthManager({
      workspaceId: 'ws-1',
      creatorKeyId,
      allowList: { emails: [], signedAt: 0, signature: '' },
    }),
    creator
  )
  const invite = await manager.createInvite('Acme', ['alice@example.com'])
  return { creator, creatorKeyId, manager, invite }
}

describe('WorkspaceAuthManager.canInvite', () => {
  it('is true on the device that created the workspace', async () => {
    const { manager } = await creatorSetup()
    expect(await manager.canInvite()).toBe(true)
  })

  // Not a role check that could be relaxed: the creator's key never leaves the
  // browser profile that made the workspace, so no other device can produce a
  // signature peers would accept.
  it('is false for a member who did not create the workspace', async () => {
    const { creatorKeyId, invite } = await creatorSetup()
    const member = withIdentity(
      new WorkspaceAuthManager({
        workspaceId: invite.workspaceId,
        creatorKeyId,
        allowList: invite.allowList,
      }),
      memoryIdentity()
    )

    expect(await member.canInvite()).toBe(false)
  })
})

describe('WorkspaceAuthManager.addMembers', () => {
  it('adds an email and keeps the list verifiable by the creator key', async () => {
    const { manager, creatorKeyId } = await creatorSetup()

    const next = await manager.addMembers(['bob@example.com'])

    expect(next.emails).toContain('alice@example.com')
    expect(next.emails).toContain('bob@example.com')
    expect(await verifyAllowList(next, creatorKeyId)).toBe(true)
  })

  it('signs a strictly newer list so peers adopt it over the old one', async () => {
    const { manager, invite } = await creatorSetup()
    await new Promise(r => setTimeout(r, 5))

    const next = await manager.addMembers(['bob@example.com'])

    expect(next.signedAt).toBeGreaterThan(invite.allowList.signedAt)
  })

  it('normalizes and de-duplicates added emails', async () => {
    const { manager } = await creatorSetup()

    const next = await manager.addMembers([' Bob@Example.com ', 'bob@example.com'])

    expect(next.emails.filter(e => e === 'bob@example.com')).toHaveLength(1)
  })

  it('becomes the list this manager presents from then on', async () => {
    const { manager } = await creatorSetup()
    await manager.addMembers(['bob@example.com'])

    expect(manager.getAllowList().emails).toContain('bob@example.com')
  })

  it('refuses on a non-creator device, rather than signing a list peers reject', async () => {
    const { creatorKeyId, invite } = await creatorSetup()
    const member = withIdentity(
      new WorkspaceAuthManager({
        workspaceId: invite.workspaceId,
        creatorKeyId,
        allowList: invite.allowList,
      }),
      memoryIdentity()
    )

    await expect(member.addMembers(['mallory@evil.com'])).rejects.toThrow(/only the workspace creator/i)
  })

  // The reason canInvite() exists: without the guard the member would sign
  // happily, get a link, share it — and every peer would reject the invitee,
  // with the failure surfacing far from the cause.
  it('a non-creator signature would not verify against the workspace, hence the guard', async () => {
    const { creatorKeyId } = await creatorSetup()
    const impostor = memoryIdentity()
    const impostorManager = withIdentity(
      new WorkspaceAuthManager({
        workspaceId: 'ws-1',
        // Impostor claims their own key is the creator key locally...
        creatorKeyId: await impostor.publicKeyId(),
        allowList: { emails: [], signedAt: 0, signature: '' },
      }),
      impostor
    )
    const forged = await impostorManager.addMembers(['mallory@evil.com'])

    // ...but against the real workspace's creator key it is worthless.
    expect(await verifyAllowList(forged, creatorKeyId)).toBe(false)
  })
})
