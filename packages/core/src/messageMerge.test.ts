import { describe, expect, it } from 'vitest'
import {
  applyToggleReaction,
  isAcceptableRevision,
  mergeReactionsByActorKey,
  revisionScore,
  upsertByIdSorted,
} from './messageMerge.js'

describe('messageMerge', () => {
  it('scores revisions by max edit/delete', () => {
    expect(revisionScore({})).toBe(0)
    expect(revisionScore({ editedAt: 5 })).toBe(5)
    expect(revisionScore({ deletedAt: 9, editedAt: 3 })).toBe(9)
  })

  it('rejects revisions from a different author key', () => {
    expect(
      isAcceptableRevision(
        { editedAt: 1 },
        { editedAt: 99 },
        { existingAuthorKey: 'a', incomingAuthorKey: 'b' }
      )
    ).toBe(false)
  })

  it('strict mode requires a greater score', () => {
    expect(
      isAcceptableRevision({ editedAt: 5 }, { editedAt: 5 }, { strict: true })
    ).toBe(false)
    expect(
      isAcceptableRevision({ editedAt: 5 }, { editedAt: 6 }, { strict: true })
    ).toBe(true)
  })

  it('non-strict accepts equal scores', () => {
    expect(
      isAcceptableRevision({ editedAt: 5 }, { editedAt: 5 }, { strict: false })
    ).toBe(true)
  })

  it('merges reactions by actor+emoji keeping latest timestamp', () => {
    const merged = mergeReactionsByActorKey(
      [
        { emoji: '👍', timestamp: 1, actor: 'u1', active: true },
        { emoji: '❤️', timestamp: 2, actor: 'u2', active: true },
      ],
      [{ emoji: '👍', timestamp: 3, actor: 'u1', active: false }],
      r => r.actor
    )
    expect(merged).toEqual([
      { emoji: '👍', timestamp: 3, actor: 'u1', active: false },
      { emoji: '❤️', timestamp: 2, actor: 'u2', active: true },
    ])
  })

  it('applies toggle reactions without tombstones', () => {
    const withThumb = applyToggleReaction([], {
      emoji: '👍',
      authorKey: 'u1',
      active: true,
    })
    expect(withThumb).toHaveLength(1)
    const removed = applyToggleReaction(withThumb, {
      emoji: '👍',
      authorKey: 'u1',
      active: false,
    })
    expect(removed).toEqual([])
  })

  it('upserts by id sorted by timestamp', () => {
    type M = { id: string; timestamp: number; text: string }
    const a: M = { id: '2', timestamp: 2, text: 'b' }
    const b: M = { id: '1', timestamp: 1, text: 'a' }
    let list = upsertByIdSorted([], a, (x, y) => y)
    list = upsertByIdSorted(list, b, (x, y) => y)
    expect(list.map(m => m.id)).toEqual(['1', '2'])
    list = upsertByIdSorted(list, { id: '2', timestamp: 2, text: 'B' }, (x, y) => ({
      ...x,
      text: y.text,
    }))
    expect(list[1].text).toBe('B')
  })
})
