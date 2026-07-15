import { describe, expect, it } from 'vitest'
import { buildSenderDirectory, enrichMessage, resolveSenderAvatar } from './senderDirectory'
import type { Message } from '../types'

describe('senderDirectory', () => {
  it('maps message sender ids to peer profiles by display name', () => {
    const peers = [
      {
        id: 'connection-peer-id',
        name: 'Alice',
        color: '#36c5f0',
        avatar: 'data:image/webp;base64,abc',
      },
    ]
    const message: Message = {
      id: '1',
      text: 'hi',
      senderId: 'different-sender-id',
      senderName: 'Alice',
      senderColor: '#000',
      timestamp: 1,
      channelId: 'general',
      type: 'text',
    }

    const directory = buildSenderDirectory('self', { name: 'Bob', color: '#fff' }, peers, [message])

    expect(resolveSenderAvatar(message, directory, peers)).toBe('data:image/webp;base64,abc')
    expect(enrichMessage(message, directory, peers).senderAvatar).toBe('data:image/webp;base64,abc')
  })
})