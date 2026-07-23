import { beforeAll, describe, expect, it } from 'vitest'
import { canonicalizePublicKey } from './deviceIdentity'
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
const attestation = { providerId: 'google', idToken: 'header.payload.signature' }
const bobRendezvousId = 'AbCdEf0123456789_bob-opaque-capability-value'
const testDmSecret = '0'.repeat(32)

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
      toRendezvousId: bobRendezvousId,
      attestation,
    })
    expect(invite.toRendezvousId).toBe(bobRendezvousId)
    expect(JSON.stringify(invite)).not.toMatch(/[0-9a-f]{64}/i)
    expect(await verifyFriendInvite(invite)).toBe(true)
    expect(parseFriendInvitePayload(invite)?.inviteId).toBe('inv-1')
  })

  it('rejects tampered invites', async () => {
    const invite = await createFriendInvite(identity, {
      inviteId: 'inv-2',
      fromUserId: 'alice',
      fromName: 'Alice',
      fromEmail: 'alice@example.com',
      toRendezvousId: bobRendezvousId,
      attestation,
    })
    const tampered = { ...invite, fromName: 'Eve' }
    expect(await verifyFriendInvite(tampered)).toBe(false)
  })

  it('rejects target substitution and expired invites', async () => {
    const invite = await createFriendInvite(identity, {
      inviteId: 'inv-target',
      fromUserId: 'alice',
      fromName: 'Alice',
      fromEmail: 'alice@example.com',
      toRendezvousId: bobRendezvousId,
      attestation,
    })
    expect(await verifyFriendInvite({
      ...invite,
      toRendezvousId: 'AbCdEf0123456789_eve-opaque-capability-value',
    })).toBe(false)
    expect(await verifyFriendInvite({
      ...invite,
      ts: Date.now() - (8 * 24 * 60 * 60 * 1000),
    })).toBe(false)
    expect(await verifyFriendInvite({
      ...invite,
      ts: Date.now() + (10 * 60 * 1000),
    })).toBe(false)
  })

  it('rejects legacy deterministic-email invite envelopes', () => {
    expect(parseFriendInvitePayload({
      v: 1,
      inviteId: 'legacy',
      fromUserId: 'alice',
      fromName: 'Alice',
      fromEmail: 'alice@example.com',
      fromEmailHash: 'a'.repeat(64),
      toEmailHash: 'b'.repeat(64),
      dmSecret: testDmSecret,
      ts: Date.now(),
      deviceKeyId: 'P-256:x:y',
      attestation,
      sig: 'sig',
    })).toBeNull()
  })

  it('creates and verifies accept/decline responses', async () => {
    const accept = await createFriendInviteResponse(identity, {
      inviteId: 'inv-3',
      accept: true,
      fromUserId: 'bob',
      fromName: 'Bob',
      fromEmail: 'bob@example.com',
      toUserId: 'alice',
      dmSecret: testDmSecret,
      attestation,
    })
    expect(await verifyFriendInviteResponse(accept)).toBe(true)
    expect(parseFriendInviteResponsePayload(accept)?.fromEmail).toBe('bob@example.com')
    expect(await verifyFriendInviteResponse({ ...accept, inviteId: 'cross-invite' })).toBe(false)

    const decline = await createFriendInviteResponse(identity, {
      inviteId: 'inv-4',
      accept: false,
      fromUserId: 'bob',
      fromName: 'Bob',
      fromEmail: 'bob@example.com',
      toUserId: 'alice',
      attestation,
    })
    expect(decline.fromEmail).toBeUndefined()
    expect(await verifyFriendInviteResponse(decline)).toBe(true)
  })

  it('parses presence with an opaque rendezvous capability only', () => {
    expect(parsePresencePayload({ userId: 'u1', name: 'Ada', rendezvousId: 'short' })).toBeNull()
    const rendezvousId = 'AbCdEf0123456789_opaque-capability-value'
    expect(parsePresencePayload({ userId: 'u1', name: 'Ada', rendezvousId })).toEqual({
      userId: 'u1',
      name: 'Ada',
      rendezvousId,
    })
  })
})
