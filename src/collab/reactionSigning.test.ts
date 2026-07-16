import { describe, expect, it } from 'vitest'
import type { KvStore } from '../utils/kvStore'
import { DeviceIdentity } from './deviceIdentity'
import {
  sanitizeReactions,
  signedReactionBytes,
  verifyReaction,
  type SignedReactionFields,
} from './reactionSigning'

function memoryStore(): KvStore<CryptoKeyPair> {
  const map = new Map<string, CryptoKeyPair>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
  }
}

async function signedReaction() {
  const identity = new DeviceIdentity(memoryStore())
  const actorDeviceKeyId = await identity.publicKeyId()
  const fields: SignedReactionFields = {
    messageId: 'm1',
    channelId: 'general',
    emoji: '👍',
    active: true,
    actorUserId: 'user-alice',
    actorDeviceKeyId,
    timestamp: 123,
  }
  return {
    identity,
    fields,
    record: {
      actorId: 'peer-alice',
      emoji: fields.emoji,
      active: fields.active,
      actorUserId: fields.actorUserId,
      actorDeviceKeyId,
      timestamp: fields.timestamp,
      signature: await identity.sign(signedReactionBytes(fields)),
    },
  }
}

describe('reaction signing', () => {
  it('verifies exact fields and rejects a changed emoji', async () => {
    const { record } = await signedReaction()
    expect(await verifyReaction(record, 'm1', 'general')).toBe(true)
    expect(await verifyReaction({ ...record, emoji: '😂' }, 'm1', 'general')).toBe(false)
  })

  it('keeps valid reactions but strips an unbound identity claim', async () => {
    const { fields, record } = await signedReaction()
    const bound = await sanitizeReactions(
      [record],
      'm1',
      'general',
      key => (key === fields.actorDeviceKeyId ? 'user-alice' : undefined)
    )
    expect(bound[0].actorUserId).toBe('user-alice')

    const unbound = await sanitizeReactions([record], 'm1', 'general', () => undefined)
    expect(unbound[0].actorUserId).toBeUndefined()
  })
})
