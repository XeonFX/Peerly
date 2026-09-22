import { describe, expect, it, vi } from 'vitest'
import { deriveChannelCapability, sendRealtimeCommand } from '@peerly/core'
import { authorizeDmContent, authorizeWorkspaceContent } from './content'

vi.mock('@peerly/core', async importOriginal => ({
  ...await importOriginal<typeof import('@peerly/core')>(),
  sendRealtimeCommand: vi.fn(async () => ({ routeId: 'opaque-route' })),
}))

describe('content authorization never sends encryption secrets', () => {
  it('sends only a domain-separated capability for a workspace', async () => {
    const secret = 'workspace-root-secret'
    const creatorKeyId = 'creator-public-key'
    const scope = await deriveChannelCapability(secret, `workspace-content:${creatorKeyId}`)
    await authorizeWorkspaceContent({ capability: secret, creatorKeyId,
      allowList: { emails: ['alice@example.com'], signedAt: 1, signature: 'signed', scope } })
    const call = vi.mocked(sendRealtimeCommand).mock.calls.at(-1)!
    expect(call).toEqual(['peerly', 'workspace.content.authorize', {
      capability: scope, creatorKeyId,
      allowList: { emails: ['alice@example.com'], signedAt: 1, signature: 'signed', scope },
    }])
    expect(JSON.stringify(call)).not.toContain(secret)
  })

  it('sends a distinct DM capability, never the room encryption secret', async () => {
    const secret = 'dm-root-secret'
    await authorizeDmContent(secret, 'bob')
    const call = vi.mocked(sendRealtimeCommand).mock.calls.at(-1)!
    expect(call).toEqual(['peerly', 'dm.content.authorize', {
      capability: await deriveChannelCapability(secret, 'dm-content'), peerUserId: 'bob',
    }])
    expect(JSON.stringify(call)).not.toContain(secret)
  })
})
