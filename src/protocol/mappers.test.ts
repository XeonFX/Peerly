import { describe, expect, it } from 'vitest'
import { chatPayloadToMessage, historyEntryToMessage, toHistoryEntry } from './mappers'
import type { ChatPayload } from './types'

describe('protocol mappers', () => {
  it('converts chat payloads to messages', () => {
    const payload: ChatPayload = {
      id: '1',
      text: 'hello',
      senderId: 'a',
      senderName: 'Alice',
      senderColor: '#fff',
      timestamp: 1,
      channelId: 'general',
      type: 'text',
    }
    expect(chatPayloadToMessage(payload)).toEqual({ ...payload, type: 'text' })
  })

  it('round-trips history entries without file urls', () => {
    const message = historyEntryToMessage(
      {
        id: 'f1',
        text: 'Shared doc.txt',
        senderId: 'a',
        senderName: 'Alice',
        senderColor: '#fff',
        timestamp: 2,
        channelId: 'general',
        type: 'file',
        fileMeta: {
          id: 'f1',
          name: 'doc.txt',
          mimeType: 'text/plain',
          size: 12,
        },
      },
      'blob:file'
    )

    const entry = toHistoryEntry(message)
    expect(entry.fileMeta?.name).toBe('doc.txt')
    expect(entry.fileMeta?.id).toBe('f1')
  })
})