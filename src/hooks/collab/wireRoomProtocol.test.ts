import { describe, expect, it, vi } from 'vitest'
import { wireRoomProtocol } from './wireRoomProtocol'
import type { RoomProtocolHandlers } from './wireRoomProtocol'
import type { ChatPayload, FileMetaPayload } from '../../protocol/types'

type Listener = { onMessage?: unknown; onReceiveProgress?: unknown; onRequest?: unknown }

/** Minimal fake room that lets a test drive inbound messages as a given peer. */
function createFakeRoom() {
  const actions = new Map<string, Listener>()

  const room = {
    makeAction: (id: string) => {
      const action: Listener & { send: unknown; requestMany: unknown } = {
        send: vi.fn(async () => {}),
        requestMany: vi.fn(async () => []),
      }
      actions.set(id, action)
      return action
    },
    getPeers: () => ({}),
    onPeerJoin: null,
    onPeerLeave: null,
    onPeerStream: null,
  }

  return { room, actions }
}

function noopHandlers(): RoomProtocolHandlers {
  return {
    onProfile: vi.fn(),
    onChat: vi.fn(),
    onFileProgress: vi.fn(),
    onFile: vi.fn(),
    onFileMeta: vi.fn(),
    onHistoryRequest: vi.fn(() => []),
    onFileRequest: vi.fn(),
    onPeerJoin: vi.fn(),
    onPeerLeave: vi.fn(),
    onPeerStream: vi.fn(),
    onInitialPeers: vi.fn(),
    onChannel: vi.fn(),
    onReaction: vi.fn(),
  }
}

function noopBindings() {
  return {
    bindChatAction: vi.fn(),
    bindProfileAction: vi.fn(),
    bindFileAction: vi.fn(),
    bindFileMetaAction: vi.fn(),
    bindHistoryAction: vi.fn(),
    bindChannelAction: vi.fn(),
    bindFileRequestAction: vi.fn(),
    bindReactionAction: vi.fn(),
    broadcastProfile: vi.fn(),
  }
}

describe('wireRoomProtocol identity handling', () => {
  it('stamps the authenticated peer id over a spoofed chat senderId', () => {
    const { room, actions } = createFakeRoom()
    const handlers = noopHandlers()
    wireRoomProtocol(room as never, handlers, noopBindings() as never)

    // Mallory claims to be Alice.
    const spoofed: ChatPayload = {
      id: 'm1',
      text: 'transfer the funds',
      senderId: 'alice-peer-id',
      senderName: 'Alice',
      senderColor: '#fff',
      timestamp: 1,
      channelId: 'general',
      type: 'text',
    }

    const chat = actions.get('chat') as { onMessage: (p: ChatPayload, m: unknown) => void }
    chat.onMessage(spoofed, { peerId: 'mallory-peer-id' })

    expect(handlers.onChat).toHaveBeenCalledTimes(1)
    const received = (handlers.onChat as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatPayload
    expect(received.senderId).toBe('mallory-peer-id')
  })

  it('stamps the authenticated peer id over spoofed file metadata', () => {
    const { room, actions } = createFakeRoom()
    const handlers = noopHandlers()
    wireRoomProtocol(room as never, handlers, noopBindings() as never)

    const spoofedMeta: FileMetaPayload = {
      id: 'f1',
      name: 'payroll.xlsx',
      mimeType: 'application/octet-stream',
      size: 4,
      senderId: 'alice-peer-id',
      senderName: 'Alice',
      senderColor: '#fff',
      timestamp: 1,
      channelId: 'general',
    }

    const file = actions.get('file') as {
      onMessage: (d: ArrayBuffer, m: unknown) => void
      onReceiveProgress: (p: number, m: unknown) => void
    }

    file.onMessage(new ArrayBuffer(4), { peerId: 'mallory-peer-id', metadata: spoofedMeta })
    const meta = (handlers.onFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as FileMetaPayload
    expect(meta.senderId).toBe('mallory-peer-id')

    file.onReceiveProgress(0.5, { peerId: 'mallory-peer-id', metadata: spoofedMeta })
    const progressMeta = (handlers.onFileProgress as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as FileMetaPayload
    expect(progressMeta.senderId).toBe('mallory-peer-id')

    const fileMeta = actions.get('file-meta') as {
      onMessage: (m: FileMetaPayload, context: unknown) => void
    }
    fileMeta.onMessage(spoofedMeta, { peerId: 'mallory-peer-id' })
    const announcedMeta = (handlers.onFileMeta as ReturnType<typeof vi.fn>).mock.calls[0][0] as FileMetaPayload
    expect(announcedMeta.senderId).toBe('mallory-peer-id')
  })

  it('passes the requesting peer id to file requests so DM files can be scoped', () => {
    const { room, actions } = createFakeRoom()
    const handlers = noopHandlers()
    wireRoomProtocol(room as never, handlers, noopBindings() as never)

    const fileReq = actions.get('file-req') as { onMessage: (ids: string[], m: unknown) => void }
    fileReq.onMessage(['f1'], { peerId: 'mallory-peer-id' })

    expect(handlers.onFileRequest).toHaveBeenCalledWith(['f1'], 'mallory-peer-id')
  })
})
