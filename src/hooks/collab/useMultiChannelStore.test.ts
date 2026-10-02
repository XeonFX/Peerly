// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileCache } from '../../collab/fileCache'
import { useMultiChannelStore } from './useMultiChannelStore'

describe('useMultiChannelStore history entries', () => {
  // A history request names its channel; a peer can name a key every object inherits.
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'answers a request for "%s" with no history instead of throwing',
    channelId => {
      const { result } = renderHook(() => useMultiChannelStore('team', 'general', new FileCache(), ['general']))
      expect(result.current.getHistoryEntries(channelId)).toEqual([])
    }
  )

  it.each(['constructor', 'toString', 'hasOwnProperty'])(
    'takes history another peer sent for a channel named "%s" as a new channel, without throwing',
    async channelId => {
      const { result } = renderHook(() => useMultiChannelStore('team', 'general', new FileCache(), ['general']))
      const entry = {
        id: 'm1', text: 'hi', senderId: 'bob', senderName: 'Bob', senderColor: '#000', timestamp: 1, channelId, type: 'text' as const,
      }
      await act(async () => {
        await result.current.applyHistory([entry])
      })
      expect(result.current.getHistoryEntries(channelId).map(e => e.id)).toEqual(['m1'])
    }
  )
})
