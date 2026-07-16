import { describe, expect, it } from 'vitest'
import {
  buildSenderDirectory,
  enrichMessage,
  resolveSenderAvatar,
  resolveSenderInfo,
} from './senderDirectory'
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

  // selfId is random per page load: a message sent before a refresh carries a
  // sender id that matches nothing afterwards. Without the past-ids mapping it
  // froze at the snapshot stored in the message and ignored renames/avatars.
  it('maps own messages from earlier sessions to the live profile', () => {
    const message: Message = {
      id: '1',
      text: 'hi',
      senderId: 'old-session-self-id',
      senderName: 'kristpav',
      senderColor: '#36c5f0',
      timestamp: 1,
      channelId: 'general',
      type: 'text',
    }
    const selfProfile = { name: 'Krystian', color: '#2eb67d', avatar: 'data:image/webp;base64,new' }

    const directory = buildSenderDirectory(
      'current-self-id',
      selfProfile,
      [],
      [message],
      ['old-session-self-id']
    )
    const sender = resolveSenderInfo(message, directory)

    expect(sender.name).toBe('Krystian')
    expect(sender.avatar).toBe('data:image/webp;base64,new')
  })

  it('falls back to the message snapshot without the past-ids mapping', () => {
    const message: Message = {
      id: '1',
      text: 'hi',
      senderId: 'old-session-self-id',
      senderName: 'kristpav',
      senderColor: '#36c5f0',
      timestamp: 1,
      channelId: 'general',
      type: 'text',
    }

    const directory = buildSenderDirectory('current-self-id', { name: 'Krystian', color: '#2eb67d' }, [], [message])

    expect(resolveSenderInfo(message, directory).name).toBe('kristpav')
  })

  it('a live peer wins over a stale past-self id on collision', () => {
    const peers = [{ id: 'shared-id', name: 'Alice', color: '#36c5f0' }]
    const directory = buildSenderDirectory(
      'self',
      { name: 'Bob', color: '#fff' },
      peers,
      [],
      ['shared-id']
    )

    expect(directory['shared-id'].name).toBe('Alice')
  })
})
