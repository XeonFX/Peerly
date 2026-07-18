import { beforeAll, describe, expect, it } from 'vitest'
import { canonicalizePublicKey } from './deviceIdentity'
import {
  addFriend,
  emptyFriends,
  inviteableFriendEmails,
  isFriend,
  listFriends,
  removeFriend,
} from './friendsStore'

let publicKeyId: string
const identity = {
  publicKeyId: async () => publicKeyId,
  sign: async (bytes: Uint8Array) => {
    // Tests only need a stable fake signature for storage shape — createPeopleAttestation
    // still produces a real ECDSA signature via this sign callback.
    const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])
    publicKeyId = await canonicalizePublicKey(key.publicKey)
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.privateKey,
      bytes as BufferSource
    )
    return Buffer.from(sig).toString('base64url')
  },
}

beforeAll(async () => {
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  publicKeyId = await canonicalizePublicKey(key.publicKey)
  // Use a real signing key for the rest of the suite.
  const privateKey = key.privateKey
  identity.sign = async (bytes: Uint8Array) => {
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      bytes as BufferSource
    )
    return Buffer.from(sig).toString('base64url')
  }
  identity.publicKeyId = async () => publicKeyId
})

describe('friendsStore', () => {
  it('adds and removes friends with email', async () => {
    const list = emptyFriends()
    await addFriend(list, identity as never, {
      ownerUserId: 'me',
      subjectUserId: 'them',
      subjectName: 'Ada',
      subjectEmail: 'ada@example.com',
    })
    expect(isFriend(list, 'them')).toBe(true)
    expect(listFriends(list)[0]?.subjectEmail).toBe('ada@example.com')
    expect(removeFriend(list, 'them')).toBe(true)
    expect(isFriend(list, 'them')).toBe(false)
  })

  it('lists inviteable friends not already on the allow-list', async () => {
    const list = emptyFriends()
    await addFriend(list, identity as never, {
      ownerUserId: 'me',
      subjectUserId: 'a',
      subjectName: 'Ada',
      subjectEmail: 'ada@example.com',
    })
    await addFriend(list, identity as never, {
      ownerUserId: 'me',
      subjectUserId: 'b',
      subjectName: 'Bob',
      subjectEmail: 'bob@example.com',
    })
    const inviteable = inviteableFriendEmails(list, ['bob@example.com'])
    expect(inviteable.map(f => f.subjectEmail)).toEqual(['ada@example.com'])
  })
})
