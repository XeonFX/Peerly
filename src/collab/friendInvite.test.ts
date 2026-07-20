import { beforeAll, describe, expect, it } from 'vitest'
import { canonicalizePublicKey } from './deviceIdentity'
import { hashEmail } from './emailHash'
import {
  createFriendInvite,
  createFriendInviteResponse,
  parseFriendInvitePayload,
  parseFriendInviteResponsePayload,
  parsePresencePayload,
  verifyFriendInvite,
  verifyFriendInviteResponse,
} from './friendInvite'

const identity = {
  publicKeyId: async () => '',
  sign: async (_bytes: Uint8Array) => '',
}

beforeAll(async () => {
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const publicKeyId = await canonicalizePublicKey(key.publicKey)
  identity.publicKeyId = async () => publicKeyId
  identity.sign = async bytes => {
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.privateKey,
      bytes as BufferSource
    )
    return Buffer.from(sig).toString('base64url')
  }
})

describe('friendInvite protocol', () => {
  it('creates and verifies a signed invite', async () => {
    const invite = await createFriendInvite(identity, {
      inviteId: 'inv-1',
      fromUserId: 'alice',
      fromName: 'Alice',
      fromEmail: 'alice@example.com',
      toEmail: 'bob@example.com',
    })
    expect(invite.toEmailHash).toBe(await hashEmail('bob@example.com'))
    expect(await verifyFriendInvite(invite)).toBe(true)
    expect(parseFriendInvitePayload(invite)?.inviteId).toBe('inv-1')
  })

  it('rejects tampered invites', async () => {
    const invite = await createFriendInvite(identity, {
      inviteId: 'inv-2',
      fromUserId: 'alice',
      fromName: 'Alice',
      fromEmail: 'alice@example.com',
      toEmail: 'bob@example.com',
    })
    const tampered = { ...invite, fromName: 'Eve' }
    expect(await verifyFriendInvite(tampered)).toBe(false)
  })

  it('creates and verifies accept/decline responses', async () => {
    const accept = await createFriendInviteResponse(identity, {
      inviteId: 'inv-3',
      accept: true,
      fromUserId: 'bob',
      fromName: 'Bob',
      fromEmail: 'bob@example.com',
      toUserId: 'alice',
      dmSecret: '0123456789abcdef0123456789abcdef',
    })
    expect(await verifyFriendInviteResponse(accept)).toBe(true)
    expect(parseFriendInviteResponsePayload(accept)?.fromEmail).toBe('bob@example.com')

    const decline = await createFriendInviteResponse(identity, {
      inviteId: 'inv-4',
      accept: false,
      fromUserId: 'bob',
      fromName: 'Bob',
      fromEmail: 'bob@example.com',
      toUserId: 'alice',
    })
    expect(decline.fromEmail).toBeUndefined()
    expect(await verifyFriendInviteResponse(decline)).toBe(true)
  })

  it('parses presence with email hash only', () => {
    expect(parsePresencePayload({ userId: 'u1', name: 'Ada', emailHash: 'ab' })).toBeNull()
    const hash = 'a'.repeat(64)
    expect(parsePresencePayload({ userId: 'u1', name: 'Ada', emailHash: hash })).toEqual({
      userId: 'u1',
      name: 'Ada',
      emailHash: hash,
    })
  })
})
