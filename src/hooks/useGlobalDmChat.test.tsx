// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const transport = vi.hoisted(() => ({ rooms: new Map<string, any>() }))
vi.mock('@peerly/core', async importOriginal => ({ ...await importOriginal<any>(), verifyTextChat: async () => true }))
vi.mock('@peerly/core/react', async importOriginal => ({
  ...await importOriginal<any>(),
  useRoom: ({ roomId }: any) => ({ room: transport.rooms.get(roomId) ?? null }),
  useDurableChannel: () => ({ room: null }),
}))
vi.mock('./useMessageOutbox', () => ({ useMessageOutbox: () => ({ entries: [], error: null, enqueue: async () => {}, retry: async () => {} }) }))
import { useGlobalDmChat } from './useGlobalDmChat'
import { loadGlobalDmHistory, saveGlobalDmHistory } from '../collab/globalDmHistory'

it('switching A to B never persists or rebroadcasts history from A', async () => {
  localStorage.clear()
  const rooms = ['room-a', 'room-b'].map(code => {
    const actions = new Map<string, any>()
    const room = { getPeers: () => ({}), makeAction: (name: string) => {
      if (!actions.has(name)) actions.set(name, { send: vi.fn(async () => {}), onMessage: null })
      return actions.get(name)
    }, onPeerJoin: null as any, onPeerLeave: null as any }
    transport.rooms.set(code, room)
    return { room, actions }
  })
  const wire = { id: 'private-a', ts: Date.now(), text: 'private message intended only for A', name: 'Me',
    authorUserId: 'me', deviceKeyId: 'own-key', sig: 'fixture-signature' }
  saveGlobalDmHistory('room-a', [wire as any])
  const shared = { identity: { publicKeyId: async () => 'own-key' } as any,
    profile: { userId: 'me', name: 'Me' } as any, friendDeviceKeyId: 'friend-key', friendName: 'Friend' }
  const hook = renderHook(({ code, friend }) => useGlobalDmChat({ ...shared, roomCode: code, friendUserId: friend }),
    { initialProps: { code: 'room-a', friend: 'friend-a' } })
  await waitFor(() => expect(hook.result.current.messages.map(m => m.id)).toEqual(['private-a']))
  hook.rerender({ code: 'room-b', friend: 'friend-b' })
  await waitFor(() => expect(loadGlobalDmHistory('room-b').map(m => m.id)).not.toContain('private-a'))
  await act(async () => { rooms[1].room.onPeerJoin('friend-b-peer') })
  expect(rooms[1].actions.get('gdmhist').send).not.toHaveBeenCalled()
  expect(hook.result.current.messages).toEqual([])
  hook.unmount()
})
