import { useCallback, useRef } from 'react'
import {
  GENERAL_CHANNEL,
  getCustomChannels,
  mergeWorkspaceChannel,
  removeWorkspaceChannel,
} from '../../collab/channelStore'
import type { ChannelPayload } from '../../protocol/types'
import type { Channel } from '../../types'

function toChannelPayload(channel: Channel): ChannelPayload {
  return {
    id: channel.id,
    name: channel.name,
    description: channel.description,
    kind: channel.kind,
    peerId: channel.peerId,
    operation: 'upsert',
    updatedAt: channel.updatedAt,
    order: channel.order,
  }
}

function payloadToChannel(payload: ChannelPayload): Channel {
  return {
    id: payload.id,
    name: payload.name,
    description: payload.description ?? '',
    kind: payload.kind ?? 'channel',
    peerId: payload.peerId,
    updatedAt: payload.updatedAt,
    order: payload.order,
  }
}

export function useChannelSync(workspaceId: string, onChannelsChange?: () => void) {
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  const channelActionRef = useRef<{
    send: (data: ChannelPayload, options?: { target?: string }) => Promise<void>
  } | null>(null)

  const handleChannel = useCallback(
    (payload: ChannelPayload, fromPeerId: string) => {
      if (payload.operation === 'delete') {
        if (removeWorkspaceChannel(workspaceIdRef.current, payload.id, payload.updatedAt)) {
          onChannelsChange?.()
        }
        return
      }
      const channel = payloadToChannel(payload)

      if (channel.kind === 'dm') {
        // Kept as an explicit compatibility boundary: old clients may still
        // announce workspace-local DMs, but current clients neither persist nor
        // surface them. All DMs live in the global friend system.
        void fromPeerId
        return
      }

      if (mergeWorkspaceChannel(workspaceIdRef.current, channel)) onChannelsChange?.()
    },
    [onChannelsChange]
  )

  const sendChannel = useCallback(async (channel: Channel, target?: string) => {
    if (!channelActionRef.current || channel.id === GENERAL_CHANNEL.id) return
    await channelActionRef.current.send(toChannelPayload(channel), target ? { target } : undefined)
  }, [])

  const announceChannel = useCallback(
    async (channel: Channel) => {
      const target = channel.kind === 'dm' ? channel.peerId : undefined
      await sendChannel(channel, target)
    },
    [sendChannel]
  )

  const announceChannelDeletion = useCallback(async (channelId: string, deletedAt: number) => {
    if (!channelActionRef.current || channelId === GENERAL_CHANNEL.id) return
    await channelActionRef.current.send({
      id: channelId,
      name: channelId,
      operation: 'delete',
      updatedAt: deletedAt,
    })
  }, [])

  const broadcastAllToPeer = useCallback(
    async (peerId: string) => {
      if (!channelActionRef.current) return
      for (const channel of getCustomChannels(workspaceIdRef.current)) {
        await sendChannel(channel, peerId)
      }
    },
    [sendChannel]
  )

  const bindChannelAction = useCallback(
    (action: {
      send: (data: ChannelPayload, options?: { target?: string }) => Promise<void>
    }) => {
      channelActionRef.current = action
    },
    []
  )

  const unbindChannelAction = useCallback(() => {
    channelActionRef.current = null
  }, [])

  return {
    handleChannel,
    announceChannel,
    announceChannelDeletion,
    broadcastAllToPeer,
    bindChannelAction,
    unbindChannelAction,
  }
}
