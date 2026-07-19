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
  })

  it('prunes stale entries', () => {
    const idx = createPresenceIndex(1_000)
    idx.record('p', { userId: 'u', name: 'X', seenAt: Date.now() - 5_000 })
    expect(idx.prune()).toBe(true)
    expect(idx.isUserOnline('u')).toBe(false)
  })

  it('rebinds userId when peerId changes', () => {
    const idx = createPresenceIndex()
    idx.record('old', { userId: 'u', name: 'A' })
    idx.record('new', { userId: 'u', name: 'A' })
    expect(idx.peerIdForUserId('u')).toBe('new')
    expect(idx.get('old')).toBeUndefined()
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
