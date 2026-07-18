import { describe, expect, it } from 'vitest'
import type { Channel, Message } from '../types'
import { searchMessages } from './messageSearch'

const channel = (id: string, name = id): Channel =>
  ({ id, name, kind: 'channel' }) as Channel

const msg = (id: string, text: string, timestamp: number, extra: Partial<Message> = {}): Message =>
  ({ id, text, timestamp, senderId: 's', senderName: 'S', ...extra }) as Message

const general = channel('general')
const random = channel('random')

describe('searchMessages', () => {
  it('ignores queries shorter than the minimum', () => {
    const byChannel = { general: [msg('1', 'hello world', 1)] }
    expect(searchMessages([general], byChannel, 'h')).toEqual([])
    expect(searchMessages([general], byChannel, '')).toEqual([])
  })

  it('matches case-insensitively across channels, newest first', () => {
    const byChannel = {
      general: [msg('1', 'Deploy on Friday', 10)],
      random: [msg('2', 'friday plans?', 20)],
    }
    const hits = searchMessages([general, random], byChannel, 'FRIDAY')
    expect(hits.map(h => h.message.id)).toEqual(['2', '1'])
    expect(hits[0].channel.id).toBe('random')
  })

  it('skips deleted and empty messages', () => {
    const byChannel = {
      general: [
        msg('1', 'keep this', 5),
        msg('2', 'gone', 6, { deletedAt: 7 }),
        msg('3', '', 8),
      ],
    }
    const hits = searchMessages([general], byChannel, 'keep')
    expect(hits.map(h => h.message.id)).toEqual(['1'])
    expect(searchMessages([general], byChannel, 'gone')).toEqual([])
  })

  it('caps the number of results', () => {
    const many = Array.from({ length: 60 }, (_, i) => msg(String(i), `match ${i}`, i))
    const hits = searchMessages([general], { general: many }, 'match', 50)
    expect(hits).toHaveLength(50)
  })
})
