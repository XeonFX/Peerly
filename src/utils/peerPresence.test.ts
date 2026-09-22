import { describe, expect, it } from 'vitest'
import type { Peer } from '../types'
import { aggregatePeersByUserId } from './peerPresence'

const peer = (id: string, userId?: string, presenceOnly = false): Peer => ({
  id,
  userId,
  presenceOnly,
  name: id,
  color: '#5865f2',
})

describe('aggregatePeersByUserId', () => {
  it('shows several authenticated tabs for one user as one person', () => {
    expect(
      aggregatePeersByUserId([
        peer('alice-tab-1', 'alice'),
        peer('alice-tab-2', 'alice'),
        peer('bob-tab', 'bob'),
      ]).map(item => item.id)
    ).toEqual(['alice-tab-1', 'bob-tab'])
  })

  it('does not show another tab of the current user beside the self row', () => {
    expect(
      aggregatePeersByUserId(
        [peer('my-other-tab', 'me'), peer('alice-tab', 'alice')],
        'me'
      ).map(item => item.id)
    ).toEqual(['alice-tab'])
  })

  it('prefers an authenticated P2P peer to a relay-only presence entry', () => {
    expect(
      aggregatePeersByUserId([
        peer('relay:alice', 'alice', true),
        peer('alice-tab', 'alice'),
      ])
    ).toEqual([peer('alice-tab', 'alice')])
  })

  it('keeps unverified connections separate because identity is unknown', () => {
    expect(
      aggregatePeersByUserId([peer('unknown-1'), peer('unknown-2')])
    ).toHaveLength(2)
  })
})
