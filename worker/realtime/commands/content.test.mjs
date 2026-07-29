import { describe, expect, it, vi } from 'vitest'
import { derivePrivateMemberId } from '../../../packages/core/worker/realtime/crypto.mjs'
import {
  createContentHandlers,
  dmContentAuthorizeCommand,
  workspaceContentAuthorizeCommand,
} from './content.mjs'
import {
  E2E_ALLOW_LIST,
  E2E_CREATOR_KEY_ID,
  E2E_WORKSPACE_ID,
} from '../../../src/collab/e2eConstants.ts'

const SECRET = 'test-opaque-user-secret'

function build(authorizeResult = { ok: true }) {
  const authorize = vi.fn(async () => authorizeResult)
  const getByName = vi.fn(() => ({ authorize }))
  const handlers = createContentHandlers({
    channels: { getByName },
    appName: 'peerly',
    opaqueUserIdSecret: SECRET,
    clock: { nowMs: () => 1_800_000_000_000 },
  })
  return { handlers, authorize, getByName }
}

describe('Peerly durable content authorization', () => {
  it('accepts a valid creator-signed workspace list for its verified member', async () => {
    const privateMemberId = await derivePrivateMemberId(
      SECRET,
      'peerly',
      'alice@e2e.test'
    )
    const payload = workspaceContentAuthorizeCommand.validate({
      capability: E2E_WORKSPACE_ID,
      creatorKeyId: E2E_CREATOR_KEY_ID,
      allowList: E2E_ALLOW_LIST,
    })
    const { handlers, authorize } = build()
    const result = await handlers['workspace.content.authorize'](payload, {
      identity: 'opaque-alice',
      publicUserId: 'public-alice',
      privateMemberId,
      deviceKeyId: 'device-alice',
    })
    expect(result.routeId).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'opaque-alice',
      publicUserId: 'public-alice',
      principalId: privateMemberId,
      authority: expect.objectContaining({
        version: E2E_ALLOW_LIST.signedAt,
      }),
    }))
    const members = authorize.mock.calls[0][0].authority.members
    expect(members).toHaveLength(2)
    expect(new Set(members).size).toBe(2)
  })

  it('rejects a tampered workspace list and a non-member identity', async () => {
    const validPayload = workspaceContentAuthorizeCommand.validate({
      capability: E2E_WORKSPACE_ID,
      creatorKeyId: E2E_CREATOR_KEY_ID,
      allowList: E2E_ALLOW_LIST,
    })
    const { handlers } = build()
    await expect(
      handlers['workspace.content.authorize'](
        {
          ...validPayload,
          allowList: {
            ...validPayload.allowList,
            emails: [...validPayload.allowList.emails, 'mallory@e2e.test'],
          },
        },
        {
          identity: 'opaque-alice',
          publicUserId: 'public-alice',
          privateMemberId: await derivePrivateMemberId(
            SECRET,
            'peerly',
            'alice@e2e.test'
          ),
          deviceKeyId: 'device-alice',
        }
      )
    ).rejects.toThrow('workspace authority signature is invalid')

    await expect(
      handlers['workspace.content.authorize'](validPayload, {
        identity: 'opaque-mallory',
        publicUserId: 'public-mallory',
        privateMemberId: await derivePrivateMemberId(
          SECRET,
          'peerly',
          'mallory@e2e.test'
        ),
        deviceKeyId: 'device-mallory',
      })
    ).rejects.toThrow('workspace membership is required')
  })

  it('initializes a DM authority from exactly the authenticated pair', async () => {
    const payload = dmContentAuthorizeCommand.validate({
      capability: 'a'.repeat(64),
      peerUserId: 'public-bob',
    })
    const { handlers, authorize } = build()
    await handlers['dm.content.authorize'](payload, {
      identity: 'opaque-alice',
      publicUserId: 'public-alice',
      privateMemberId: 'private-alice',
      deviceKeyId: 'device-alice',
    })
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      principalId: 'public-alice',
      authority: {
        version: 1,
        fingerprint: 'public-alice\npublic-bob',
        members: ['public-alice', 'public-bob'],
      },
    }))
  })
})
