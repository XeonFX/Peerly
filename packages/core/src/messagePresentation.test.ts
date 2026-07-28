import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MESSAGE_GROUP_WINDOW_MS,
  groupConsecutiveMessages,
} from './messagePresentation'

type Message = { id: string; author: string; timestamp: number }

const group = (messages: Message[]) =>
  groupConsecutiveMessages(messages, {
    authorId: message => message.author,
    timestamp: message => message.timestamp,
  })

describe('groupConsecutiveMessages', () => {
  it('combines adjacent messages from one author', () => {
    const groups = group([
      { id: '1', author: 'alice', timestamp: 1_000 },
      { id: '2', author: 'alice', timestamp: 2_000 },
      { id: '3', author: 'bob', timestamp: 3_000 },
    ])

    expect(groups.map(item => item.messages.map(message => message.id))).toEqual([
      ['1', '2'],
      ['3'],
    ])
    expect(groups.map(item => item.startsDay)).toEqual([true, false])
  })

  it('starts a new group after the inactivity window', () => {
    const groups = group([
      { id: '1', author: 'alice', timestamp: 1_000 },
      {
        id: '2',
        author: 'alice',
        timestamp: 1_000 + DEFAULT_MESSAGE_GROUP_WINDOW_MS + 1,
      },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[1]?.startsDay).toBe(false)
  })

  it('starts a new group and day at a local calendar-day boundary', () => {
    const dayOne = new Date(2026, 6, 28, 23, 59).getTime()
    const dayTwo = new Date(2026, 6, 29, 0, 1).getTime()

    const groups = group([
      { id: '1', author: 'alice', timestamp: dayOne },
      { id: '2', author: 'alice', timestamp: dayTwo },
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(item => item.startsDay)).toEqual([true, true])
  })

  it('does not merge messages whose timestamps move backwards', () => {
    expect(
      group([
        { id: '1', author: 'alice', timestamp: 2_000 },
        { id: '2', author: 'alice', timestamp: 1_000 },
      ])
    ).toHaveLength(2)
  })
})
