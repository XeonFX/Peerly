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

  // Cross-device case: a message sent from another browser carries a transport
  // id this device never saw and a name that may since have changed. Only the
  // durable user id can link it back to the person.
  it('resolves messages by durable user id when the transport id is unknown', () => {
    const message: Message = {
      id: '1',
      text: 'from my laptop',
      senderId: 'other-device-transport-id',
      senderUserId: 'user-abc',
      senderName: 'Old Name',
      senderColor: '#000',
      timestamp: 1,
      channelId: 'general',
      type: 'text',
    }

    const directory = buildSenderDirectory(
      'self',
      { name: 'Krystian', color: '#2eb67d', avatar: 'data:image/webp;base64,me' },
      [],
      [message],
      [],
      'user-abc'
    )
    const sender = resolveSenderInfo(message, directory)

    expect(sender.name).toBe('Krystian')
    expect(sender.avatar).toBe('data:image/webp;base64,me')
  })

  it('self wins over a connected peer sharing the same user id (my other device)', () => {
    const peers = [
      { id: 'peer-1', userId: 'user-abc', name: 'Me on laptop', color: '#000' },
    ]
    const directory = buildSenderDirectory(
      'self',
      { name: 'Me here', color: '#fff' },
      peers,
      [],
      [],
      'user-abc'
    )

    expect(directory['user:user-abc'].name).toBe('Me here')
  })

  it('resolves a peer message by user id after that peer reconnects with a new transport id', () => {
    const message: Message = {
      id: '1',
      text: 'hi',
      senderId: 'bobs-old-transport-id',
      senderUserId: 'user-bob',
      senderName: 'Bob',
      senderColor: '#000',
      timestamp: 1,
      channelId: 'general',
      type: 'text',
    }
    const peers = [
      { id: 'bobs-new-transport-id', userId: 'user-bob', name: 'Bobby', color: '#123' },
    ]

    const directory = buildSenderDirectory('self', { name: 'Me', color: '#fff' }, peers, [message])

    expect(resolveSenderInfo(message, directory, peers).name).toBe('Bobby')
  })

  it('enrichMessage backfills the durable id from the live peer, not the wire', () => {
    const message: Message = {
      id: '1',
      text: 'hi',
      senderId: 'peer-1',
      senderName: 'Bob',
      senderColor: '#000',
      timestamp: 1,
      channelId: 'general',
      type: 'text',
    }
    const peers = [{ id: 'peer-1', userId: 'user-bob', name: 'Bob', color: '#123' }]
    const directory = buildSenderDirectory('self', { name: 'Me', color: '#fff' }, peers)

    expect(enrichMessage(message, directory, peers).senderUserId).toBe('user-bob')
  })
})
