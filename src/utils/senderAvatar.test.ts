import { describe, expect, it } from 'vitest'
import { resolveSenderAvatar } from './senderAvatar'

describe('resolveSenderAvatar', () => {
  it('prefers live profile avatars over stale message payloads', () => {
    const avatar = resolveSenderAvatar(
      { senderId: 'peer-1', senderName: 'Peer', senderColor: '#000', senderAvatar: undefined },
      'self',
      { name: 'Me', color: '#fff' },
      { 'peer-1': { id: 'peer-1', name: 'Peer', color: '#000', avatar: 'data:image/webp;base64,abc' } }
    )

    expect(avatar).toBe('data:image/webp;base64,abc')
  })
})