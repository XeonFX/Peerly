import { useCallback, useRef } from 'react'
import {
  GENERAL_CHANNEL,
  getCustomChannels,
  mergeWorkspaceChannel,
  removeWorkspaceChannel,
} from '../../collab/channelStore'
import { loadWorkspaceDms, mergeDmChannel, routeDmChannel } from '../../collab/dmStore'
import { selfId } from '../../collab/identity'
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
        // A DM is only ours to store if the channel id says it is between us and
        // the peer that actually sent it. Otherwise any peer could fabricate a
        // thread between two other people.
        const route = routeDmChannel(channel.id, selfId)
        if (route.kind !== 'dm' || route.peerId !== fromPeerId) return

        // `payload.peerId` is the *sender's* view of the other side — i.e. us —
        // and is attacker-controlled either way. The peer of this thread, from
        // our side, is whoever sent it.
        const merged = mergeDmChannel(workspaceIdRef.current, {
          ...channel,
          peerId: fromPeerId,
        })
        if (merged) onChannelsChange?.()
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
      for (const channel of loadWorkspaceDms(workspaceIdRef.current)) {
        if (channel.peerId === peerId) {
          await sendChannel(channel, peerId)
        }
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
