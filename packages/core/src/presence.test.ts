import { describe, expect, it } from 'vitest'
import {
  createPresenceIndex,
  parsePresencePayload,
  PRESENCE_TTL_MS,
} from './presence.js'

describe('createPresenceIndex', () => {
  it('records and looks up by userId and emailHash', () => {
    const idx = createPresenceIndex()
    const hash = 'a'.repeat(64)
    idx.record('peer-1', { userId: 'u1', name: 'Ada', emailHash: hash })
    expect(idx.isUserOnline('u1')).toBe(true)
    expect(idx.peerIdForUserId('u1')).toBe('peer-1')
    expect(idx.peerIdForEmailHash(hash)).toBe('peer-1')
    expect(idx.peerIdsForEmailHash(hash)).toEqual(['peer-1'])
  })

  it('prunes stale entries', () => {
    const idx = createPresenceIndex(1_000)
    idx.record('p', { userId: 'u', name: 'X', seenAt: Date.now() - 5_000 })
    expect(idx.prune()).toBe(true)
    expect(idx.isUserOnline('u')).toBe(false)
  })

  it('keeps every online device for the same user', () => {
    const idx = createPresenceIndex()
    idx.record('old', { userId: 'u', name: 'A' })
    idx.record('new', { userId: 'u', name: 'A' })
    expect(idx.peerIdForUserId('u')).toBe('new')
    expect(idx.peerIdsForUserId('u')).toEqual(['old', 'new'])
    expect(idx.get('old')).toBeDefined()
    idx.drop('new')
    expect(idx.peerIdForUserId('u')).toBe('old')
  })

  it('removes stale reverse indexes when one peer changes identity', () => {
    const idx = createPresenceIndex()
    const oldHash = 'a'.repeat(64)
    const newHash = 'b'.repeat(64)
    idx.record('peer', { userId: 'old-user', name: 'Old', emailHash: oldHash })
    idx.record('peer', { userId: 'new-user', name: 'New', emailHash: newHash })
    expect(idx.peerIdForUserId('old-user')).toBeUndefined()
    expect(idx.peerIdForEmailHash(oldHash)).toBeUndefined()
    expect(idx.peerIdForUserId('new-user')).toBe('peer')
    expect(idx.peerIdForEmailHash(newHash)).toBe('peer')
  })

  it('exports a positive default TTL', () => {
    expect(PRESENCE_TTL_MS).toBeGreaterThan(10_000)
  })
})

describe('parsePresencePayload', () => {
  it('accepts name-only presence', () => {
    expect(parsePresencePayload({ userId: 'u1', name: 'Sam' })).toEqual({
      userId: 'u1',
      name: 'Sam',
    })
  })

  it('requires email hash when asked', () => {
    expect(parsePresencePayload({ userId: 'u1', name: 'Sam' }, { requireEmailHash: true })).toBeNull()
    const hash = 'b'.repeat(64)
    expect(
      parsePresencePayload({ userId: 'u1', name: 'Sam', emailHash: hash }, { requireEmailHash: true })
    ).toEqual({ userId: 'u1', name: 'Sam', emailHash: hash })
  })
})
