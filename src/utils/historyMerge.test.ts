import { describe, expect, it } from 'vitest'
import { mergeHistoryEntries } from './historyMerge'

describe('mergeHistoryEntries', () => {
  it('deduplicates by id and sorts by timestamp', () => {
    const merged = mergeHistoryEntries(
      [
        {
          id: '2',
          text: 'second',
          senderId: 'a',
          senderName: 'Alice',
          senderColor: '#fff',
          timestamp: 2,
          channelId: 'general',
          type: 'text',
        },
      ],
      [
        {
          id: '1',
          text: 'first',
          senderId: 'b',
          senderName: 'Bob',
          senderColor: '#000',
          timestamp: 1,
          channelId: 'general',
          type: 'text',
        },
        {
          id: '2',
          text: 'duplicate',
          senderId: 'b',
          senderName: 'Bob',
          senderColor: '#000',
          timestamp: 99,
          channelId: 'general',
          type: 'text',
        },
      ]
    )

    expect(merged.map(message => message.id)).toEqual(['1', '2'])
    expect(merged[1].text).toBe('second')
  })

  it('fills missing file urls from the provided map', () => {
    const merged = mergeHistoryEntries(
      [
        {
          id: 'f1',
          text: 'Shared file',
          senderId: 'a',
          senderName: 'Alice',
          senderColor: '#fff',
          timestamp: 1,
          channelId: 'general',
          type: 'file',
          file: {
            id: 'f1',
            name: 'a.txt',
            mimeType: 'text/plain',
            size: 1,
            url: '',
          },
        },
      ],
      [
        {
          id: 'f1',
          text: 'Shared file',
          senderId: 'a',
          senderName: 'Alice',
          senderColor: '#fff',
          timestamp: 1,
          channelId: 'general',
          type: 'file',
          fileMeta: {
            id: 'f1',
            name: 'a.txt',
            mimeType: 'text/plain',
            size: 1,
          },
        },
      ],
      new Map([['f1', 'blob:file']])
    )

    expect(merged[0].file?.url).toBe('blob:file')
  })

  it('adopts newer same-author revisions and reaction events', () => {
    const existing = {
      id: 'm1',
      text: 'original',
      senderId: 'peer-a',
      senderUserId: 'user-a',
      senderName: 'Alice',
      senderColor: '#fff',
      timestamp: 1,
      channelId: 'general',
      type: 'text' as const,
    }
    const merged = mergeHistoryEntries([existing], [
      {
        ...existing,
        text: 'edited',
        editedAt: 2,
        reactions: [
          {
            emoji: '👍',
            active: true,
            actorId: 'peer-b',
            actorUserId: 'user-b',
            timestamp: 3,
          },
        ],
      },
    ])

    expect(merged[0].text).toBe('edited')
    expect(merged[0].editedAt).toBe(2)
    expect(merged[0].reactions?.[0].emoji).toBe('👍')
  })
})
