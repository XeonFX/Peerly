import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileTransfer, Message, Peer, SharedFile, UserProfile } from '../types'
import { formatBytes, formatTime } from '../utils/format'
import { isInlineImageType, isInlineVideoType } from '../utils/fileType'
import { isProbablyNsfwUrlCached } from '../collab/nsfwGate'
import { buildSenderDirectory, resolveSenderInfo } from '../utils/senderDirectory'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { SafeMessageText } from './SafeMessageText'
import { useI18n } from '../i18n'

type Props = {
  messages: Message[]
  /** Resets scroll anchoring when the user switches channels. */
  channelId: string
  selfId: string
  /** Durable id of the signed-in user — links messages across devices. */
  selfUserId?: string
  /** Past sessions' ids for this workspace — our old messages carry them. */
  pastSelfIds?: string[]
  selfProfile: UserProfile
  peers: Peer[]
  transfers: FileTransfer[]
  onRequestFile: (file: SharedFile, channelId: string) => Promise<void>
  onNsfwVerdict: (fileId: string, nsfw: boolean) => void
  onEditMessage: (messageId: string, text: string) => void
  onDeleteMessage: (messageId: string) => void
  onToggleReaction: (messageId: string, emoji: string) => void
}

function FileAttachment({
  file,
  transfer,
  onRequest,
  onNsfwVerdict,
}: {
  file: SharedFile
  transfer?: FileTransfer
  onRequest: (file: SharedFile) => Promise<void>
  onNsfwVerdict: (fileId: string, nsfw: boolean) => void
}) {
  const { tr } = useI18n()
  const [flagged, setFlagged] = useState(Boolean(file.nsfw))
  const [revealed, setRevealed] = useState(false)
  const source = file.url || file.thumbnail
  const image = isInlineImageType(file.mimeType)
  const video = isInlineVideoType(file.mimeType)

  useEffect(() => {
    // `undefined` means never screened; a stored true OR false is final —
    // re-running the classifier on every mount was the app's biggest
    // avoidable inference cost.
    if (!source || !image || file.nsfw !== undefined) return
    let cancelled = false
    void isProbablyNsfwUrlCached(file.id, source).then(result => {
      if (cancelled) return
      if (result) setFlagged(true)
      onNsfwVerdict(file.id, result)
    })
    return () => {
      cancelled = true
    }
  }, [file.id, file.nsfw, image, source, onNsfwVerdict])

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
              data-testid="download-original"
            >
              <span>{tr('Preview')}</span>
              <span>{tr('Download original')} · {formatBytes(file.size)}</span>
            </button>
          )}
          {hidden && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/45 p-4 text-center text-white">
              <Icon name="shield" size={22} />
              <strong className="text-sm">{tr('Sensitive media hidden')}</strong>
              <span className="text-xs text-white/75">{tr('Checked privately on this device')}</span>
              <button type="button" className="btn btn-sm border-white/30 bg-white/15 text-white hover:bg-white/25" onClick={() => setRevealed(true)}>
                {tr('Reveal')}
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
          <Icon name="paperclip" className="text-primary" />
          <span className="flex min-w-0 flex-col">
            <strong className="truncate text-sm font-medium">{file.name}</strong>
            <span className="text-xs text-base-content/65">{formatBytes(file.size)} · {tr('Ready on this device')}</span>
          </span>
          <span className="ml-2 text-primary">{tr('Save')}</span>
        </a>
      ) : (
        <button
          type="button"
          onClick={() => void onRequest(file)}
          className="file-download inline-flex items-center gap-2.5 rounded-xl border border-base-300 bg-base-100 px-3 py-2.5 text-left transition hover:border-primary/35 hover:shadow-sm"
        >
          <Icon name="paperclip" className="text-primary" />
          <span className="flex min-w-0 flex-col">
            <strong className="truncate text-sm font-medium">{file.name}</strong>
            <span className="text-xs text-base-content/65">{formatBytes(file.size)} · {tr('Download on demand')}</span>
          </span>
          <Icon name="download" size={17} className="ml-2 text-primary" />
        </button>
      )}

      {transfer && (
        <div className="mt-2 max-w-xs">
          <progress className="progress progress-primary h-1.5 w-full" value={transfer.percent} max={1} />
          <span className="text-[0.7rem] text-base-content/65">{tr('Receiving')} {Math.round(transfer.percent * 100)}%</span>
        </div>
      )}
    </div>
  )
}

export function MessageList({
  messages,
  channelId,
  selfId,
  selfUserId,
  pastSelfIds = [],
  selfProfile,
  peers,
  transfers,
  onRequestFile,
  onNsfwVerdict,
  onEditMessage,
  onDeleteMessage,
  onToggleReaction,
}: Props) {
  const { tr } = useI18n()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const previousMessageIdsRef = useRef<Set<string>>(new Set())
  const prevChannelRef = useRef(channelId)
  const [pendingBelow, setPendingBelow] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const senderDirectory = useMemo(
    () => buildSenderDirectory(selfId, selfProfile, peers, messages, pastSelfIds, selfUserId),
    [selfId, selfProfile, peers, messages, pastSelfIds, selfUserId]
  )

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottomRef.current) setPendingBelow(0)
  }

  const jumpToBottom = (behavior: ScrollBehavior = 'smooth') => {
    nearBottomRef.current = true
    setPendingBelow(0)
    bottomRef.current?.scrollIntoView({ behavior })
  }

  // Anchor, don't hijack: the old behaviour scrolled to the bottom on EVERY
  // messages change — reading history got yanked down whenever anyone posted,
  // history synced, or even a background screening verdict persisted. Now the
  // view follows only when the reader is already at the bottom (or just sent
  // the message themselves); otherwise a pill counts what arrived below.
  useEffect(() => {
    const channelChanged = prevChannelRef.current !== channelId
    prevChannelRef.current = channelId
    const previousIds = previousMessageIdsRef.current
    const addedMessages = messages.filter(message => !previousIds.has(message.id))
    const addedCount = addedMessages.length
    previousMessageIdsRef.current = new Set(messages.map(message => message.id))

    if (channelChanged) {
      jumpToBottom('auto')
      return
    }
    if (addedCount === 0) return

    const latestIncoming = [...addedMessages]
      .reverse()
      .find(message => message.senderId !== selfId)
    if (latestIncoming && latestIncoming.timestamp > Date.now() - 30_000) {
      setAnnouncement(
        latestIncoming.type === 'file'
          ? tr('{name} shared {file}', { name: latestIncoming.senderName, file: latestIncoming.file?.name ?? tr('a file') })
          : `${latestIncoming.senderName}: ${latestIncoming.text}`
      )
    }

    const lastIsOwn = messages[messages.length - 1]?.senderId === selfId
    if (nearBottomRef.current || lastIsOwn) {
      jumpToBottom()
    } else {
      setPendingBelow(count => count + addedCount)
    }
  }, [messages, channelId, selfId, tr])

  if (messages.length === 0) {
    return (
      <div className="message-list flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="empty-state-art mx-auto mb-5" aria-hidden="true">
            <span className="empty-state-orbit empty-state-orbit-one" />
            <span className="empty-state-orbit empty-state-orbit-two" />
            <span className="empty-state-icon">
              <Icon name="message-circle" size={29} />
            </span>
          </div>
          <h3 className="mb-1.5 text-lg font-semibold tracking-tight">{tr('Start the conversation')}</h3>
          <p className="text-sm leading-relaxed text-base-content/65">
            {tr('Messages are sent directly peer-to-peer. No server stores your data.')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="message-list flex-1 overflow-y-auto px-3 py-4 sm:px-5"
      >
        {messages.map(msg => {
          const sender = resolveSenderInfo(msg, senderDirectory, peers)
          const ownMessage = selfUserId
            ? msg.senderUserId === selfUserId
            : msg.senderId === selfId || pastSelfIds.includes(msg.senderId)
          const activeReactions = (msg.reactions ?? []).filter(reaction => reaction.active)
          const reactionCounts = activeReactions.reduce<Record<string, number>>((counts, reaction) => {
            counts[reaction.emoji] = (counts[reaction.emoji] ?? 0) + 1
            return counts
          }, {})

          return (
            <div
              key={msg.id}
              className="chat-message-row group flex gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-base-200/40"
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
                  <span className="shrink-0 text-[0.7rem] text-base-content/60">
                    {formatTime(msg.timestamp)}
                  </span>
                  {msg.editedAt && !msg.deletedAt && (
                    <span className="text-[0.65rem] text-base-content/65">{tr('edited')}</span>
                  )}
                  {ownMessage && msg.type === 'text' && !msg.deletedAt && (
                    <span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-square"
                        aria-label={tr('Edit message')}
                        title={tr('Edit message')}
                        onClick={() => {
                          const text = window.prompt(tr('Edit message'), msg.text)?.trim()
                          if (text && text !== msg.text) onEditMessage(msg.id, text)
                        }}
                      >
                        <Icon name="pencil" size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-square text-error"
                        aria-label={tr('Delete message')}
                        title={tr('Delete message')}
                        onClick={() => {
                          if (window.confirm(tr('Delete this message for everyone online?'))) {
                            onDeleteMessage(msg.id)
                          }
                        }}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </span>
                  )}
                </div>

                <div className="text-sm leading-relaxed text-base-content/90">
                  {msg.deletedAt ? (
                    <p className="italic text-base-content/65">{tr('Message deleted')}</p>
                  ) : msg.type === 'text' ? (
                    <SafeMessageText text={msg.text} />
                  ) : msg.file ? (
                    <div className="mt-1">
                      <FileAttachment
                        file={msg.file}
                        transfer={transfers.find(
                          t => t.id === msg.file?.id && t.direction === 'receive'
                        )}
                        onRequest={file => onRequestFile(file, msg.channelId)}
                        onNsfwVerdict={onNsfwVerdict}
                      />
                    </div>
                  ) : null}
                </div>
                {!msg.deletedAt && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {Object.entries(reactionCounts).map(([emoji, count]) => (
                      <button
                        key={emoji}
                        type="button"
                        className="badge badge-outline h-6 gap-1 border-base-300 bg-base-100 hover:border-primary/50"
                        onClick={() => onToggleReaction(msg.id, emoji)}
                        aria-label={tr('{emoji} reaction, {count}', { emoji, count })}
                      >
                        <span>{emoji}</span><span>{count}</span>
                      </button>
                    ))}
                    <span className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {['👍', '❤️', '😂', '🎉'].map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          className="btn btn-ghost btn-xs btn-square"
                          onClick={() => onToggleReaction(msg.id, emoji)}
                          aria-label={tr('React {emoji}', { emoji })}
                        >
                          {emoji}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      {pendingBelow > 0 && (
        <button
          type="button"
          className="btn btn-primary btn-sm absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg"
          onClick={() => jumpToBottom()}
          data-testid="new-messages-pill"
        >
          ↓ {pendingBelow} {tr(pendingBelow === 1 ? 'new message' : 'new messages')}
        </button>
      )}
    </div>
  )
}
