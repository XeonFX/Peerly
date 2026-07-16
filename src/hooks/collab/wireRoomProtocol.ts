import type { joinRoom } from '@trystero-p2p/nostr'
import { ACTION_IDS } from '../../protocol/types'
import type {
  ChannelPayload,
  ChatPayload,
  FileMetaPayload,
  HistoryEntry,
  HistoryRequest,
  ReactionPayload,
} from '../../protocol/types'
import { senderFromProfile } from '../../protocol/types'
import { chatPayloadToMessage, clampMessageText } from '../../protocol/mappers'
import type { UserProfile } from '../../types'

type Room = ReturnType<typeof joinRoom>

export type RoomProtocolHandlers = {
  onProfile: (profile: UserProfile, peerId: string) => void
  onChat: (payload: ChatPayload) => void
  onFileProgress: (percent: number, peerId: string, meta: FileMetaPayload) => void
  onFile: (data: ArrayBuffer, meta: FileMetaPayload) => void
  onFileMeta: (meta: FileMetaPayload, peerId: string) => void
  onHistoryRequest: (channelId: string) => HistoryEntry[]
  onFileRequest: (fileIds: string[], peerId: string) => void
  onPeerJoin: (peerId: string) => void
  onPeerLeave: (peerId: string) => void
  onPeerStream: (stream: MediaStream, peerId: string) => void
  onInitialPeers: (peerIds: string[]) => void
  onChannel: (payload: ChannelPayload, peerId: string) => void
  onReaction: (payload: ReactionPayload, peerId: string) => void
}

export type RoomProtocolBindings = {
  bindChatAction: (action: {
    send: (data: ChatPayload) => Promise<void>
  }) => void
  bindProfileAction: (action: {
    send: (data: UserProfile, options?: { target?: string }) => Promise<void>
  }) => void
  bindFileAction: (action: {
    send: (
      data: ArrayBuffer,
      options?: {
        metadata?: FileMetaPayload
        onProgress?: (percent: number) => void
        target?: string
      }
    ) => Promise<void>
  }) => void
  bindFileMetaAction: (action: {
    send: (data: FileMetaPayload, options?: { target?: string }) => Promise<void>
  }) => void
  bindHistoryAction: (action: {
    requestMany: (
      data: HistoryRequest,
      options: { targets: string[]; timeoutMs?: number }
    ) => Promise<
      Array<
        | { peerId: string; status: 'fulfilled'; value: HistoryEntry[] }
        | { peerId: string; status: 'timeout' | 'rejected' | 'disconnected'; error?: Error }
      >
    >
  }) => void
  bindChannelAction: (action: {
    send: (data: ChannelPayload, options?: { target?: string }) => Promise<void>
  }) => void
  bindFileRequestAction: (action: {
    send: (data: string[], options?: { target?: string }) => Promise<void>
  }) => void
  bindReactionAction: (action: {
    send: (data: ReactionPayload, options?: { target?: string }) => Promise<void>
  }) => void
  broadcastProfile: (target?: string) => void
}

export function wireRoomProtocol(
  room: Room,
  handlers: RoomProtocolHandlers,
  bindings: RoomProtocolBindings
) {
  const chatAction = room.makeAction<ChatPayload>(ACTION_IDS.chat)
  const profileAction = room.makeAction<UserProfile>(ACTION_IDS.profile)
  const fileAction = room.makeAction<ArrayBuffer>(ACTION_IDS.file)
  const fileMetaAction = room.makeAction<FileMetaPayload>(ACTION_IDS.fileMeta)
  const historyAction = room.makeAction<HistoryRequest, HistoryEntry[]>(ACTION_IDS.historySync, {
    kind: 'request',
    onRequest: data => handlers.onHistoryRequest(data.channelId),
  })
  const channelAction = room.makeAction<ChannelPayload>(ACTION_IDS.channelSync)
  const fileRequestAction = room.makeAction<string[]>(ACTION_IDS.fileRequest)
  const reactionAction = room.makeAction<ReactionPayload>(ACTION_IDS.reaction)

  bindings.bindChatAction(chatAction)
  bindings.bindProfileAction(profileAction)
  bindings.bindFileAction(fileAction)
  bindings.bindFileMetaAction(fileMetaAction)
  bindings.bindHistoryAction(historyAction)
  bindings.bindChannelAction(channelAction)
  bindings.bindFileRequestAction(fileRequestAction)
  bindings.bindReactionAction(reactionAction)

  profileAction.onMessage = (peerProfile, { peerId }) => {
    handlers.onProfile(peerProfile, peerId)
  }

  // `peerId` is authenticated by the transport; anything in the payload is
  // attacker-controlled. Stamp the real sender over whatever was claimed so a
  // peer cannot post as someone else. Honest peers already send senderId ===
  // their own selfId, so this is a no-op for them.
  chatAction.onMessage = (payload, { peerId }) => {
    handlers.onChat({ ...payload, senderId: peerId })
  }

  fileAction.onReceiveProgress = (percent, { peerId, metadata }) => {
    const meta = metadata as FileMetaPayload
    handlers.onFileProgress(percent, peerId, { ...meta, senderId: peerId })
  }

  fileAction.onMessage = (data, { peerId, metadata }) => {
    const meta = metadata as FileMetaPayload
    handlers.onFile(data, { ...meta, senderId: peerId })
  }

  fileMetaAction.onMessage = (meta, { peerId }) => {
    handlers.onFileMeta({ ...meta, senderId: peerId }, peerId)
  }

  channelAction.onMessage = (payload, { peerId }) => {
    handlers.onChannel(payload, peerId)
  }

  fileRequestAction.onMessage = (fileIds, { peerId }) => {
    handlers.onFileRequest(fileIds, peerId)
  }

  reactionAction.onMessage = (payload, { peerId }) => {
    handlers.onReaction({ ...payload, actorId: peerId }, peerId)
  }

  room.onPeerJoin = peerId => {
    bindings.broadcastProfile(peerId)
    handlers.onPeerJoin(peerId)
  }

  room.onPeerLeave = peerId => {
    handlers.onPeerLeave(peerId)
  }

  room.onPeerStream = (stream, peerId) => {
    handlers.onPeerStream(stream, peerId)
  }

  bindings.broadcastProfile()

  const peerIds = Object.keys(room.getPeers())
  handlers.onInitialPeers(peerIds)

  return () => {
    profileAction.onMessage = null
    chatAction.onMessage = null
    fileAction.onMessage = null
    fileAction.onReceiveProgress = null
    fileMetaAction.onMessage = null
    historyAction.onRequest = null
    channelAction.onMessage = null
    fileRequestAction.onMessage = null
    reactionAction.onMessage = null
    room.onPeerJoin = null
    room.onPeerLeave = null
    room.onPeerStream = null
  }
}

export function createChatPayload(
  text: string,
  profile: UserProfile,
  senderId: string,
  channelId: string,
  senderUserId?: string
): ChatPayload {
  return {
    id: crypto.randomUUID(),
    text,
    ...senderFromProfile(profile, senderId),
    senderUserId,
    timestamp: Date.now(),
    channelId,
    type: 'text',
  }
}

export { chatPayloadToMessage, clampMessageText }
