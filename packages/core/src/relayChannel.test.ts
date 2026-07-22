import { describe, expect, it, vi } from 'vitest'
import { createRelayChannel } from './relayChannel.js'
import type { RelayCoordinationEvent, RelayCoordinator } from './coordination.js'

function fakeCoordinator() {
  let listener: ((event: RelayCoordinationEvent) => void) | null = null
  const coordinator = {
    subscribe: vi.fn(callback => { listener = callback; return () => { listener = null } }),
    watchChannel: vi.fn(),
    unwatchChannel: vi.fn(),
    publishChannel: vi.fn(),
  } as unknown as RelayCoordinator
  return { coordinator, emit: (event: RelayCoordinationEvent) => listener?.(event) }
}

describe('relay channel', () => {
  it('tracks remote peers and routes directed action messages', async () => {
    const fake = fakeCoordinator()
    const room = createRelayChannel(fake.coordinator, 'lobby', 'member-me')
    const joins: string[] = []
    const leaves: string[] = []
    room.onPeerJoin = id => joins.push(id)
    room.onPeerLeave = id => leaves.push(id)
    fake.emit({ type: 'status', available: true, connectionId: 'self' })
    fake.emit({
      type: 'channel.snapshot',
      channel: 'lobby',
      members: [
        { connectionId: 'self', memberId: 'member-me' },
        { connectionId: 'peer-a', memberId: 'member-a' },
      ],
    })
    expect(room.getPeers()).toEqual({ 'peer-a': { memberId: 'member-a' } })
    expect(joins).toEqual(['peer-a'])

    const action = room.makeAction<{ text: string }>('chat')
    const received = vi.fn()
    action.onMessage = received
    fake.emit({
      type: 'channel.message', channel: 'lobby', event: 'chat', messageId: 'm1',
      senderConnectionId: 'peer-a', senderMemberId: 'member-a', data: JSON.stringify({ text: 'hi' }),
    })
    expect(received).toHaveBeenCalledWith({ text: 'hi' }, { peerId: 'peer-a' })
    await action.send({ text: 'hello' }, { target: 'peer-a' })
    expect(fake.coordinator.publishChannel).toHaveBeenCalledWith(
      'lobby', 'chat', expect.any(String), JSON.stringify({ text: 'hello' }), 'peer-a'
    )

    fake.emit({ type: 'channel.snapshot', channel: 'lobby', members: [] })
    expect(leaves).toEqual(['peer-a'])
    room.leave()
    expect(fake.coordinator.unwatchChannel).toHaveBeenCalledWith('lobby')
  })

  it('ignores malformed payloads and self echoes', () => {
    const fake = fakeCoordinator()
    const room = createRelayChannel(fake.coordinator, 'lobby', 'me')
    const action = room.makeAction('chat')
    action.onMessage = vi.fn()
    fake.emit({ type: 'status', available: true, connectionId: 'self' })
    fake.emit({ type: 'channel.message', channel: 'lobby', event: 'chat', messageId: '1', senderConnectionId: 'self', senderMemberId: 'me', data: '{}' })
    fake.emit({ type: 'channel.message', channel: 'lobby', event: 'chat', messageId: '2', senderConnectionId: 'other', senderMemberId: 'them', data: '{' })
    expect(action.onMessage).not.toHaveBeenCalled()
  })
})
