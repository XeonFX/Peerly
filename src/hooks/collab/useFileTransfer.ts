import { selfId } from '../../collab/identity'
import { routeDmChannel } from '../../collab/dmStore'
import { useCallback, useRef, useState, type RefObject } from 'react'
import {
  FILE_TOO_LARGE_ERROR,
  MAX_FILE_BYTES,
  FILE_REQUEST_STAGGER_MS,
  MAX_FILE_REQUEST_IDS,
} from '../../collab/constants'
import { messageFromFileMeta } from '../../protocol/mappers'
import type { FileMetaPayload } from '../../protocol/types'
import { senderFromProfile } from '../../protocol/types'
import type { FileTransfer, Message, UserProfile } from '../../types'
import { FileCache } from '../../collab/fileCache'
import type { BlobUrlRegistry } from '../../utils/blobUrls'
import { safeFileMimeType } from '../../utils/fileType'
import { fileContentMatchesId, hashFileBytes } from '../../utils/fileHash'
import type { SignedFields } from '../../collab/messageSigning'
import { safeThumbnailUrl } from '../../utils/avatarUrl'
import { makeMediaThumbnail } from '../../utils/imageThumbnail'
import { isProbablyNsfwMedia } from '../../collab/nsfwGate'
import { estimateBrowserStorageCached, hasRoomForWrite, storagePressure } from '../../utils/browserStorage'
import { isInlineImageType, isInlineVideoType } from '../../utils/fileType'
import { loadFileSyncMode } from '../../collab/syncPreferences'

type FileAction = {
  send: (
    data: ArrayBuffer,
    options?: {
      metadata?: FileMetaPayload
      onProgress?: (percent: number) => void
      target?: string
    }
  ) => Promise<void>
}

type FileRequestAction = {
  send: (data: string[], options?: { target?: string }) => Promise<void>
}

type FileMetaAction = {
  send: (data: FileMetaPayload, options?: { target?: string }) => Promise<void>
}

export function useFileTransfer(
  channelId: string,
  profileRef: RefObject<UserProfile>,
  identityRef: RefObject<
    | {
        selfUserId?: string
        signMessage?: (
          fields: Omit<SignedFields, 'senderDeviceKeyId'>
        ) => Promise<{ senderDeviceKeyId: string; signature: string }>
      }
    | undefined
  >,
  fileCache: FileCache,
  blobUrls: RefObject<BlobUrlRegistry>,
  onFileMessage: (message: Message) => void,
  onFileNsfw?: (fileId: string, nsfw: boolean) => void
) {
  const [transfers, setTransfers] = useState<FileTransfer[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const fileActionRef = useRef<FileAction | null>(null)
  const fileRequestActionRef = useRef<FileRequestAction | null>(null)
  const fileMetaActionRef = useRef<FileMetaAction | null>(null)
  const channelIdRef = useRef(channelId)
  channelIdRef.current = channelId

  const reset = useCallback(() => {
    setTransfers([])
    setFileError(null)
  }, [])

  const reportFileError = useCallback((message: string | null) => setFileError(message), [])

  const bindFileAction = useCallback((action: FileAction) => {
    fileActionRef.current = action
  }, [])

  const unbindFileAction = useCallback(() => {
    fileActionRef.current = null
  }, [])

  const bindFileRequestAction = useCallback((action: FileRequestAction) => {
    fileRequestActionRef.current = action
  }, [])

  const bindFileMetaAction = useCallback((action: FileMetaAction) => {
    fileMetaActionRef.current = action
  }, [])

  const unbindFileMetaAction = useCallback(() => {
    fileMetaActionRef.current = null
  }, [])

  const unbindFileRequestAction = useCallback(() => {
    fileRequestActionRef.current = null
  }, [])

  const handleReceiveProgress = useCallback(
    (percent: number, peerId: string, meta: FileMetaPayload) => {
      // Don't show progress for a transfer we intend to reject on arrival.
      if (typeof meta.size === 'number' && meta.size > MAX_FILE_BYTES) return
      setTransfers(prev => {
        const existing = prev.find(t => t.id === meta.id && t.direction === 'receive')
        if (existing) {
          return prev.map(t =>
            t.id === meta.id && t.direction === 'receive' ? { ...t, percent } : t
          )
        }
        return [
          ...prev,
          {
            id: meta.id,
            name: meta.name,
            percent,
            direction: 'receive' as const,
            peerId,
          },
        ]
      })
    },
    []
  )

  const handleFileReceived = useCallback(
    async (data: ArrayBuffer, meta: FileMetaPayload) => {
      // A peer controls both the buffer and the claimed size; check the real one.
      if (data.byteLength > MAX_FILE_BYTES) {
        console.warn('[Peerly] Dropped oversized file from peer:', meta.senderId, data.byteLength)
        setTransfers(prev => prev.filter(t => t.id !== meta.id))
        return
      }

      // Already materialized — another peer answered the same pull request first.
      // Re-storing would rewrite IndexedDB and churn a new Blob for bytes we
      // already have, once per extra peer. Cheap id lookup, so it runs before
      // the hash check below spends CPU on a large buffer we'd discard anyway.
      if (blobUrls.current.get(meta.id)) {
        setTransfers(prev => prev.filter(t => t.id !== meta.id))
        return
      }

      // File ids are content hashes (see fileHash.ts): verify the bytes we
      // actually got hash to the id the sender claimed before trusting them at
      // all. Without this, whichever peer answers a pull request could serve
      // different bytes under a legitimate file's id — malware under a
      // colleague's PDF, or a swapped invoice — and it would render exactly
      // like the real file because nothing here checks. A hash mismatch means
      // the peer is either corrupt or malicious; either way, drop it.
      if (!(await fileContentMatchesId(data, meta.id))) {
        console.warn('[Peerly] Dropped file with mismatched content hash from peer:', meta.senderId)
        setTransfers(prev => prev.filter(t => t.id !== meta.id))
        return
      }

      // The sender chose this MIME type. Pin it to something inert before it can
      // reach a Blob, so it propagates sanitized into the cache, IndexedDB, and
      // history rather than being re-trusted on every later restore. The
      // thumbnail is peer-chosen too: same gate as avatars, plus a size cap,
      // BEFORE it is persisted or re-served to other peers.
      const safeMeta = {
        ...meta,
        mimeType: safeFileMimeType(meta.mimeType),
        thumbnail: safeThumbnailUrl(meta.thumbnail),
      }

      const visual = isInlineImageType(safeMeta.mimeType) || isInlineVideoType(safeMeta.mimeType)
      const nsfw = visual ? await isProbablyNsfwMedia(data, safeMeta.mimeType) : false
      const storage = await estimateBrowserStorageCached()
      const persist = hasRoomForWrite(storage, data.byteLength)
      await fileCache.set(safeMeta, data, { persist })
      if (!persist) {
        setFileError('The file is open for this session but was not cached because browser storage is low.')
      }
      const url = blobUrls.current.create(
        safeMeta.id,
        new Blob([data], { type: safeMeta.mimeType })
      )
      const message = messageFromFileMeta(safeMeta, url)
      if (message.file) message.file.nsfw = nsfw
      onFileMessage(message)
      setTransfers(prev => prev.filter(t => t.id !== safeMeta.id))
    },
    [blobUrls, fileCache, onFileMessage]
  )

  /** Ask peers for file bodies we're missing. Pull, so joins cost only the gaps. */
  const requestFilesFromPeers = useCallback(
    async (peerIds: string[], fileIds: string[]) => {
      const action = fileRequestActionRef.current
      if (!action || peerIds.length === 0 || fileIds.length === 0) return

      let wanted = [...new Set(fileIds)].slice(0, MAX_FILE_REQUEST_IDS)

      // Ask one peer at a time, re-checking what's still outstanding between
      // rounds. Asking everyone at once pulls N copies of every file from N
      // peers; they all hold the same bytes, so the extra copies are pure waste.
      for (const peerId of peerIds) {
        wanted = wanted.filter(id => !blobUrls.current.get(id))
        if (wanted.length === 0) return

        try {
          await action.send(wanted, { target: peerId })
        } catch (err) {
          console.warn('[Peerly] Failed to request files from peer:', peerId, err)
        }

        if (peerId !== peerIds[peerIds.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, FILE_REQUEST_STAGGER_MS))
        }
      }
    },
    [blobUrls]
  )

  const handleFileMeta = useCallback(
    async (meta: FileMetaPayload, peerId: string) => {
      if (meta.size > MAX_FILE_BYTES) return
      const safeMeta = {
        ...meta,
        mimeType: safeFileMimeType(meta.mimeType),
        thumbnail: safeThumbnailUrl(meta.thumbnail),
      }
      onFileMessage(messageFromFileMeta(safeMeta, ''))

      if (loadFileSyncMode() !== 'auto') return
      const storage = await estimateBrowserStorageCached()
      const pressure = storagePressure(storage.usageBytes, storage.quotaBytes)
      if (pressure === 'warning' || pressure === 'critical') return
      await requestFilesFromPeers([peerId], [safeMeta.id])
    },
    [onFileMessage, requestFilesFromPeers]
  )

  /** Serve a peer's request, sending only ids we hold and they may see. */
  const handleFileRequest = useCallback(
    async (fileIds: string[], peerId: string) => {
      const fileAction = fileActionRef.current
      if (!fileAction || !Array.isArray(fileIds)) return

      for (const id of fileIds.slice(0, MAX_FILE_REQUEST_IDS)) {
        if (typeof id !== 'string') continue
        const cached = await fileCache.load(id)
        if (!cached) continue

        // Never hand a DM attachment to anyone but that conversation's peer.
        const route = routeDmChannel(cached.meta.channelId, selfId)
        if (route.kind === 'foreign-dm') continue
        if (route.kind === 'dm' && route.peerId !== peerId) continue

        try {
          await fileAction.send(cached.buffer, { metadata: cached.meta, target: peerId })
        } catch (err) {
          console.warn('[Peerly] Failed to serve file to peer:', peerId, err)
        }
      }
    },
    [fileCache]
  )

  const sendFile = useCallback(
    async (file: File, onLocalMessage: (message: Message) => void) => {
      const fileMetaAction = fileMetaActionRef.current
      if (!fileMetaAction) return

      // Check before arrayBuffer(): reading it is what would blow the heap.
      if (file.size > MAX_FILE_BYTES) {
        setFileError(FILE_TOO_LARGE_ERROR)
        return
      }
      setFileError(null)

      // Resolve routing before sending: a DM attachment must never broadcast.
      const route = routeDmChannel(channelIdRef.current, selfId)
      if (route.kind === 'foreign-dm') return
      const target = route.kind === 'dm' ? route.peerId : undefined

      const profile = profileRef.current
      const buffer = await file.arrayBuffer()
      // Content-addressed: the id IS the hash, so nothing needs to reconcile
      // "this id" with "these bytes" later — they're the same fact.
      const safeMimeType = safeFileMimeType(file.type)
      const [id, thumbnail] = await Promise.all([
        hashFileBytes(buffer),
        makeMediaThumbnail(buffer, safeMimeType),
      ])
      const meta: FileMetaPayload = {
        id,
        name: file.name,
        // Sanitize our own uploads too: a local SVG is the same hazard to us as
        // a received one, and peers should not have to trust our labelling.
        mimeType: safeMimeType,
        size: file.size,
        thumbnail,
        ...senderFromProfile(profile, selfId),
        senderUserId: identityRef.current?.selfUserId,
        timestamp: Date.now(),
        channelId: channelIdRef.current,
      }

      // Sign the announcement so the file's attribution and displayed name
      // survive relay through history untampered (see messageSigning).
      const signer = identityRef.current?.signMessage
      if (signer) {
        const signed = await signer({
          id: meta.id,
          type: 'file',
          text: '',
          fileMeta: { id: meta.id, name: meta.name, mimeType: meta.mimeType, size: meta.size },
          senderUserId: meta.senderUserId,
          timestamp: meta.timestamp,
          channelId: meta.channelId,
        })
        meta.senderDeviceKeyId = signed.senderDeviceKeyId
        meta.signature = signed.signature
      }

      await fileCache.set(meta, buffer)

      // Build from the sanitized type, not the raw File — otherwise our own
      // preview is still a live SVG document pointed at our own origin.
      const url = blobUrls.current.create(id, new Blob([buffer], { type: meta.mimeType }))
      const message = messageFromFileMeta(meta, url)
      onLocalMessage(message)

      // Screen our own upload without holding the message hostage: the first
      // image send would otherwise wait for the full model download before the
      // sender saw their own file. Peer-received files stay blocking (safe by
      // default for content someone else chose).
      const visual = isInlineImageType(safeMimeType) || isInlineVideoType(safeMimeType)
      if (visual) {
        void isProbablyNsfwMedia(buffer, safeMimeType).then(nsfw =>
          onFileNsfw?.(id, nsfw)
        )
      }

      // Announce metadata only. Peers request the content-addressed body when
      // opened, or immediately when their device is in automatic sync mode.
      await fileMetaAction.send(meta, target ? { target } : undefined)
    },
    [blobUrls, fileCache, profileRef, identityRef, onFileNsfw]
  )

  return {
    transfers,
    fileError,
    reset,
    bindFileAction,
    unbindFileAction,
    bindFileRequestAction,
    bindFileMetaAction,
    unbindFileRequestAction,
    unbindFileMetaAction,
    handleReceiveProgress,
    handleFileReceived,
    handleFileRequest,
    handleFileMeta,
    requestFilesFromPeers,
    sendFile,
    reportFileError,
  }
}
