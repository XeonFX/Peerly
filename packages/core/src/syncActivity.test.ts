import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSyncActivities,
  getSyncActivities,
  recordSyncActivity,
  subscribeSyncActivities,
  syncPayloadBytes,
} from './syncActivity'

beforeEach(clearSyncActivities)

describe('sync activity', () => {
  it('records metadata and notifies subscribers newest-first', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSyncActivities(listener)
    recordSyncActivity({
      direction: 'received',
      kind: 'history',
      peer: { peerId: 'peer-1', relationship: 'workspace-member', name: 'Alice' },
      itemCount: 4,
      bytes: 120,
      summary: 'General · 4 messages',
    })
    expect(listener).toHaveBeenCalledOnce()
    expect(getSyncActivities()[0]).toMatchObject({ kind: 'history', itemCount: 4 })
    unsubscribe()
  })

  it('estimates UTF-8 payload bytes and bounds invalid counters', () => {
    expect(syncPayloadBytes('ą')).toBe(2)
    const item = recordSyncActivity({
      direction: 'sent',
      kind: 'message',
      peer: { relationship: 'unknown' },
      bytes: -1,
      itemCount: Number.NaN,
      summary: 'message',
    })
    expect(item.bytes).toBeUndefined()
    expect(item.itemCount).toBeUndefined()
  })
})
