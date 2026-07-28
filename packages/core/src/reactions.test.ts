import { describe, expect, it } from 'vitest'
import {
  ALLOWED_REACTIONS,
  buildReplyMessage,
  QUICK_REACTIONS,
  searchReactionCategories,
} from './reactions.js'

describe('message reactions', () => {
  it('keeps the compact default set ordered as heart, thumbs up, laugh', () => {
    expect(QUICK_REACTIONS).toEqual(['❤️', '👍', '😂'])
    expect(QUICK_REACTIONS.every(emoji => ALLOWED_REACTIONS.has(emoji))).toBe(true)
  })

  it('searches reaction keywords while preserving categories', () => {
    const results = searchReactionCategories('rocket')
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('celebration')
    expect(results[0]?.reactions.map(reaction => reaction.emoji)).toEqual(['🚀'])
  })

  it('builds a bounded, readable reply without mutating user text', () => {
    const message = buildReplyMessage('Alice', '  a   long\nmessage  ', 'I agree')
    expect(message).toBe('↪ Alice: a long message\nI agree')
  })
})
