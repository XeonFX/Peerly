import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createContentHandlers, workspaceContentAuthorizeCommand } from '../../../../worker/realtime/commands/content.mjs'
import { workspacePolicy } from '../../../../worker/realtime/commands/content.test-fixtures.mjs'
import { derivePrivateMemberId } from './crypto.mjs'

const secret = 'authority-regression-test-secret'
async function identity(name) {
  return {
    identity: `opaque-${name}`, publicUserId: `user-${name}`, deviceKeyId: `device-${name}`,
    privateMemberId: await derivePrivateMemberId(secret, 'peerly', `${name}@e2e.test`),
  }
}
function handlers() {
  return createContentHandlers({ channels: env.CONTENT_CHANNELS, appName: 'peerly',
    opaqueUserIdSecret: secret, clock: { nowMs: () => Date.now() } })
}
const authorize = (handler, payload, caller) => handler['workspace.content.authorize'](
  workspaceContentAuthorizeCommand.validate(payload), caller)

describe('workspace content authority across the real handler and DO', () => {
  it('isolates a member self-signing a new policy and keeps the real owner admitted', async () => {
    const original = await workspacePolicy()
    const alice = await identity('alice')
    const bob = await identity('bob')
    const handler = handlers()
    const admitted = await authorize(handler, original.payload, alice)
    const forged = await workspacePolicy({ secret: original.secret, emails: ['bob@e2e.test'] })
    // Even knowing the root secret cannot turn a member's signing key into
    // the original creator. It can at most create an unrelated channel.
    const unrelated = await authorize(handler, forged.payload, bob)
    expect(unrelated.routeId).not.toBe(admitted.routeId)
    expect((await authorize(handler, original.payload, alice)).routeId).toBe(admitted.routeId)
    await expect(authorize(handler, { ...original.payload,
      allowList: { ...forged.payload.allowList, scope: original.payload.capability } }, bob)
    ).rejects.toThrow('signature is invalid')
  })

  it('rejects a policy transplanted from another workspace owned by the same creator', async () => {
    const original = await workspacePolicy()
    const other = await workspacePolicy({ keys: original.keys })
    const handler = handlers()
    const alice = await identity('alice')
    await authorize(handler, original.payload, alice)
    expect(() => workspaceContentAuthorizeCommand.validate({ ...original.payload,
      allowList: other.payload.allowList })).toThrow()
    await expect(authorize(handler, { ...original.payload,
      allowList: { ...other.payload.allowList, scope: original.payload.capability } }, alice)
    ).rejects.toThrow('signature is invalid')
  })

  it('rejects future revision poisoning without preventing a legitimate removal', async () => {
    const original = await workspacePolicy()
    const alice = await identity('alice')
    const bob = await identity('bob')
    const handler = handlers()
    await authorize(handler, original.payload, alice)
    const future = await workspacePolicy({ keys: original.keys, secret: original.secret, signedAt: Number.MAX_SAFE_INTEGER })
    await expect(authorize(handler, future.payload, alice)).rejects.toThrow('revision is in the future')
    const revision = await workspacePolicy({ keys: original.keys, secret: original.secret,
      emails: ['alice@e2e.test'], signedAt: original.payload.allowList.signedAt + 1 })
    await authorize(handler, revision.payload, alice)
    await expect(authorize(handler, original.payload, bob)).rejects.toThrow('stale-authority')
  })
})
