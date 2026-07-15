import { describe, expect, it } from 'vitest'
import { countUnreadByChannel, countUnreadMessages, totalUnread } from './unreadStore'
import type { Message } from '../types'

function message(overrides: Partial<Message> & Pick<Message, 'id' | 'channelId' | 'senderId'>): Message {
  return {
    text: 'hello',
    senderName: 'Alice',
    senderColor: '#fff',
    timestamp: 1000,
    type: 'text',
    ...overrides,
  }
}

describe('unreadStore', () => {
  it('counts only peer messages after last read', () => {
    const messages = [
      message({ id: '1', channelId: 'general', senderId: 'peer', timestamp: 1000 }),
      message({ id: '2', channelId: 'general', senderId: 'peer', timestamp: 2000 }),
      message({ id: '3', channelId: 'general', senderId: 'self', timestamp: 3000 }),
    ]

    expect(countUnreadMessages(messages, 1500, 'self')).toBe(1)
    expect(countUnreadMessages(messages, undefined, 'self', 2500)).toBe(0)
  })

  it('aggregates unread counts per channel', () => {
    const counts = countUnreadByChannel(
      {
        general: [message({ id: '1', channelId: 'general', senderId: 'peer', timestamp: 2000 })],
        random: [message({ id: '2', channelId: 'random', senderId: 'peer', timestamp: 4000 })],
      },
      { general: 1000, random: 5000 },
      'self'
    )

    expect(counts).toEqual({ general: 1, random: 0 })
    expect(totalUnread(counts)).toBe(1)
  })
})