import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileTransfer, Message, Peer, SharedFile, UserProfile } from '../types'
import { formatBytes, formatTime } from '../utils/format'
import { isInlineImageType, isInlineVideoType } from '../utils/fileType'
import { isProbablyNsfwUrl } from '../collab/nsfwGate'
import { buildSenderDirectory, resolveSenderInfo } from '../utils/senderDirectory'
import { Avatar } from './Avatar'

type Props = {
  messages: Message[]
  selfId: string
  /** Durable id of the signed-in user — links messages across devices. */
  selfUserId?: string
  /** Past sessions' ids for this workspace — our old messages carry them. */
  pastSelfIds?: string[]
  selfProfile: UserProfile
  peers: Peer[]
  transfers: FileTransfer[]
  onRequestFile: (file: SharedFile) => Promise<void>
}

function FileAttachment({
  file,
  transfer,
  onRequest,
}: {
  file: SharedFile
  transfer?: FileTransfer
  onRequest: (file: SharedFile) => Promise<void>
}) {
  const [flagged, setFlagged] = useState(Boolean(file.nsfw))
  const [revealed, setRevealed] = useState(false)
  const source = file.url || file.thumbnail
  const image = isInlineImageType(file.mimeType)
  const video = isInlineVideoType(file.mimeType)

  useEffect(() => {
    if (!source || !image || file.nsfw) return
    let cancelled = false
    void isProbablyNsfwUrl(source).then(result => {
      if (!cancelled && result) setFlagged(true)
    })
    return () => {
      cancelled = true
    }
  }, [file.nsfw, image, source])

  const hidden = flagged && !revealed
  const media = image ? (
    <img
      src={source}
      alt={file.name}
      className={`file-preview max-h-64 max-w-full transition duration-200 ${hidden ? 'scale-105 blur-2xl' : ''}`}
    />
  ) : video && file.url ? (
    <video
      src={file.url}
      controls={!hidden}
      preload="metadata"
      className={`file-preview max-h-64 max-w-full transition duration-200 ${hidden ? 'scale-105 blur-2xl' : ''}`}
    />
  ) : null

  return (
    <div>
      {media ? (
        <div className="file-preview-shell relative inline-block max-w-full overflow-hidden rounded-xl border border-base-300 bg-base-200">
          {file.url && image ? (
            <a href={file.url} target="_blank" rel="noreferrer" tabIndex={hidden ? -1 : undefined}>
              {media}
            </a>
          ) : (
            media
          )}
          {!file.url && !hidden && (
            <button
              type="button"
              className="absolute inset-x-0 bottom-0 flex w-full items-center justify-between gap-3 bg-linear-to-t from-black/85 to-transparent px-3 pb-2 pt-9 text-xs text-white"
              onClick={() => void onRequest(file)}
            >
              <span>Preview</span>
              <span>Download original · {formatBytes(file.size)}</span>
            </button>
          )}
          {hidden && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/45 p-4 text-center text-white">
              <span className="text-xl" aria-hidden="true">🛡️</span>
              <strong className="text-sm">Sensitive media hidden</strong>
              <span className="text-xs text-white/75">Checked privately on this device</span>
              <button type="button" className="btn btn-sm border-white/30 bg-white/15 text-white hover:bg-white/25" onClick={() => setRevealed(true)}>
                Reveal
              </button>
            </div>
          )}
        </div>
      ) : file.url ? (
        <a
          href={file.url}
          download={file.name}
          className="file-download inline-flex items-center gap-2.5 rounded-xl border border-base-300 bg-base-100 px-3 py-2.5 transition hover:border-primary/35 hover:shadow-sm"
        >
          <span aria-hidden="true">📎</span>
          <span className="flex min-w-0 flex-col">
            <strong className="truncate text-sm font-medium">{file.name}</strong>
            <span className="text-xs text-base-content/50">{formatBytes(file.size)} · Ready on this device</span>
          </span>
          <span className="ml-2 text-primary">Save</span>
        </a>
      ) : (
        <button
          type="button"
          onClick={() => void onRequest(file)}
          className="file-download inline-flex items-center gap-2.5 rounded-xl border border-base-300 bg-base-100 px-3 py-2.5 text-left transition hover:border-primary/35 hover:shadow-sm"
        >
          <span aria-hidden="true">📎</span>
          <span className="flex min-w-0 flex-col">
            <strong className="truncate text-sm font-medium">{file.name}</strong>
            <span className="text-xs text-base-content/50">{formatBytes(file.size)} · Download on demand</span>
          </span>
          <span className="ml-2 text-primary" aria-hidden="true">↓</span>
        </button>
      )}

      {transfer && (
        <div className="mt-2 max-w-xs">
          <progress className="progress progress-primary h-1.5 w-full" value={transfer.percent} max={1} />
          <span className="text-[0.7rem] text-base-content/50">Receiving {Math.round(transfer.percent * 100)}%</span>
        </div>
      )}
    </div>
  )
}

export function MessageList({
  messages,
  selfId,
  selfUserId,
  pastSelfIds = [],
  selfProfile,
  peers,
  transfers,
  onRequestFile,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const senderDirectory = useMemo(
    () => buildSenderDirectory(selfId, selfProfile, peers, messages, pastSelfIds, selfUserId),
    [selfId, selfProfile, peers, messages, pastSelfIds, selfUserId]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="message-list flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <span
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-base-300/70 bg-base-200/70 text-3xl shadow-lg shadow-black/10"
            aria-hidden="true"
          >
            💬
          </span>
          <h3 className="mb-1 text-lg font-semibold">Start the conversation</h3>
          <p className="text-sm text-base-content/50">
            Messages are sent directly peer-to-peer. No server stores your data.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="message-list flex-1 overflow-y-auto px-3 py-4 sm:px-5">
      {messages.map(msg => {
        const sender = resolveSenderInfo(msg, senderDirectory, peers)

        return (
          <div
            key={msg.id}
            className="group flex gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-base-200/40"
            data-testid="chat-message"
          >
            {/* size="md" is deliberate: message avatars were previously sized up
                from `sm` by a CSS override, so plain `sm` would shrink them. */}
            <Avatar name={sender.name} color={sender.color} avatar={sender.avatar} size="md" />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-semibold text-base-content">
                  {sender.name}
                </span>
                <span className="shrink-0 text-[0.7rem] text-base-content/40">
                  {formatTime(msg.timestamp)}
                </span>
              </div>

              <div className="text-sm leading-relaxed text-base-content/90">
                {msg.type === 'text' ? (
                  <p className="break-words whitespace-pre-wrap">{msg.text}</p>
                ) : msg.file ? (
                  <div className="mt-1">
                    <FileAttachment
                      file={msg.file}
                      transfer={transfers.find(t => t.id === msg.file?.id && t.direction === 'receive')}
                      onRequest={onRequestFile}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
