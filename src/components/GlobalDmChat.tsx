import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { GlobalDmMessage } from '../collab/globalDmHistory'
import type { GlobalDmReaction } from '../collab/globalDmHistory'
import type { GlobalDmTransfer } from '../hooks/useGlobalDmChat'
import { useI18n } from '../i18n'
import { isInlineImageType, isInlineVideoType } from '../utils/fileType'
import { safeThumbnailUrl } from '../utils/avatarUrl'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { SafeMessageText } from './SafeMessageText'
import { formatBytes, formatTime } from '../utils/format'
import type { UserProfile } from '../types'

type Props = {
  friendName: string
  friendEmail?: string
  friendOnline: boolean
  partnerInRoom: boolean
  messages: GlobalDmMessage[]
  selfUserId: string
  selfProfile: UserProfile
  error: string | null
  searchQuery: string
  reactions: GlobalDmReaction[]
  attachmentUrls: Record<string, string>
  transfers: GlobalDmTransfer[]
  onSend: (text: string) => Promise<void>
  onFiles: (files: File[]) => Promise<void>
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>
  onEdit: (messageId: string, text: string) => void
  onDelete: (messageId: string) => void
  pendingMessage?: string
  onPendingMessageConsumed: () => void
  onClose: () => void
}

/**
 * Active global friend DM pane (home view). Transport lives in useGlobalDmChat.
 */
export function GlobalDmChat({
  friendName,
  friendEmail,
  friendOnline,
  partnerInRoom,
  messages,
  selfUserId,
  selfProfile,
  error,
  searchQuery,
  reactions,
  attachmentUrls,
  transfers,
  onSend,
  onFiles,
  onToggleReaction,
  onEdit,
  onDelete,
  pendingMessage,
  onPendingMessageConsumed,
  onClose,
}: Props) {
  const { tr } = useI18n()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const visibleMessages = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase()
    if (!needle) return messages
    return messages.filter(message =>
      `${message.text} ${message.attachment?.name ?? ''} ${message.name}`.toLocaleLowerCase().includes(needle)
    )
  }, [messages, searchQuery])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const consumedMessageRef = useRef<string | null>(null)
  useEffect(() => {
    const message = pendingMessage?.trim()
    if (!message || consumedMessageRef.current === message) return
    consumedMessageRef.current = message
    onPendingMessageConsumed()
    void onSend(message)
  }, [pendingMessage, onPendingMessageConsumed, onSend])

  const status = partnerInRoom
    ? tr('In chat')
    : friendOnline
      ? tr('Online on Peerly')
      : tr('Offline')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      await onSend(draft)
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col rounded-box border border-base-300/80 bg-base-100/90 shadow-sm"
      data-testid="global-dm-chat"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-base-300/70 px-3 py-2.5">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square lg:hidden"
          onClick={onClose}
          aria-label={tr('Back')}
          data-testid="global-dm-back"
        >
          <Icon name="x" size={16} />
        </button>
        <span data-testid="global-dm-header-avatar">
          <Avatar name={friendName} color="#5865f2" size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold" data-testid="global-dm-partner">
            {friendName}
          </h2>
          <p className="truncate text-[0.65rem] text-base-content/55">
            {friendEmail ? `${friendEmail} · ` : ''}
            <span data-testid="global-dm-status">{status}</span>
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square hidden lg:inline-flex"
          onClick={onClose}
          title={tr('Close chat')}
          aria-label={tr('Close chat')}
          data-testid="global-dm-close"
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      {error && (
        <div className="shrink-0 border-b border-error/25 bg-error/10 px-3 py-1.5 text-xs text-error">
          {error}
        </div>
      )}

      <div className="message-list min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5" data-testid="global-dm-messages">
        {visibleMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <div className="empty-state-art mx-auto mb-5" aria-hidden="true">
                <span className="empty-state-orbit empty-state-orbit-one" />
                <span className="empty-state-orbit empty-state-orbit-two" />
                <span className="empty-state-icon"><Icon name="message-circle" size={29} /></span>
              </div>
              <h3 className="mb-1.5 text-lg font-semibold tracking-tight">
                {searchQuery.trim() ? tr('No messages match your search.') : tr('Start the conversation')}
              </h3>
              {!searchQuery.trim() && (
                <p className="text-sm leading-relaxed text-base-content/65">
                  {tr('Messages are sent directly peer-to-peer. No server stores your data.')}
                </p>
              )}
            </div>
          </div>
        ) : (
          visibleMessages.map(msg => {
            const mine = msg.authorUserId === selfUserId
            const body = msg.deletedAt ? tr('Message deleted') : msg.text
            const activeReactions = reactions.filter(reaction => reaction.messageId === msg.id && reaction.active)
            const reactionCounts = activeReactions.reduce<Record<string, number>>((counts, reaction) => {
              counts[reaction.emoji] = (counts[reaction.emoji] ?? 0) + 1
              return counts
            }, {})
            const attachment = msg.attachment
            const attachmentUrl = attachment ? attachmentUrls[attachment.id] : undefined
            const transfer = attachment ? transfers.find(item => item.id === attachment.id) : undefined
            const senderName = mine ? selfProfile.name : msg.name || friendName
            return (
              <div
                key={msg.id}
                className="chat-message-row group flex gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-base-200/40"
                data-testid={mine ? 'global-dm-mine' : 'global-dm-theirs'}
              >
                <span data-testid="global-dm-avatar">
                  <Avatar
                    name={senderName}
                    color={mine ? selfProfile.color : '#5865f2'}
                    avatar={mine ? selfProfile.avatar : undefined}
                    size="md"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-semibold text-base-content">{senderName}</span>
                    <time
                      className="shrink-0 text-[0.7rem] text-base-content/60"
                      dateTime={new Date(msg.ts).toISOString()}
                      data-testid="global-dm-time"
                    >
                      {formatTime(msg.ts)}
                    </time>
                    {msg.editedAt && !msg.deletedAt && (
                      <span className="text-[0.65rem] text-base-content/65">{tr('edited')}</span>
                    )}
                    {mine && !msg.deletedAt && (
                      <span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {!attachment && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-square"
                            aria-label={tr('Edit message')}
                            title={tr('Edit message')}
                            onClick={() => {
                              const next = window.prompt(tr('Edit message'), msg.text)?.trim()
                              if (next && next !== msg.text) onEdit(msg.id, next)
                            }}
                          >
                            <Icon name="pencil" size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square text-error"
                          aria-label={tr('Delete message')}
                          title={tr('Delete message')}
                          onClick={() => {
                            if (window.confirm(tr('Delete this message for everyone online?'))) {
                              onDelete(msg.id)
                            }
                          }}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                  {(msg.deletedAt || body) && (
                    <div className="text-sm leading-relaxed text-base-content/90">
                      {msg.deletedAt
                        ? <p className="italic text-base-content/65">{body}</p>
                        : <SafeMessageText text={body} />}
                    </div>
                  )}
                  {!msg.deletedAt && attachment && (
                    <div className="mt-1.5 max-w-lg overflow-hidden rounded-xl border border-base-300 bg-base-100 p-2">
                      {safeThumbnailUrl(attachment.thumbnail) && !attachmentUrl && (
                        <img src={safeThumbnailUrl(attachment.thumbnail)} alt="" className="mb-2 max-h-44 w-full rounded-lg object-contain" />
                      )}
                      {attachmentUrl && isInlineImageType(attachment.mimeType) && (
                        <a href={attachmentUrl} target="_blank" rel="noopener noreferrer">
                          <img src={attachmentUrl} alt={attachment.name} className="mb-2 max-h-56 w-full rounded-lg object-contain" />
                        </a>
                      )}
                      {attachmentUrl && isInlineVideoType(attachment.mimeType) && (
                        <video src={attachmentUrl} controls className="mb-2 max-h-56 w-full rounded-lg" />
                      )}
                      <div className="flex items-center gap-2 text-xs">
                        <Icon name="paperclip" size={14} />
                        {attachmentUrl ? (
                          <a href={attachmentUrl} download={attachment.name} className="min-w-0 flex-1 truncate underline">{attachment.name}</a>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                        )}
                        <span className="shrink-0 opacity-60">{formatBytes(attachment.size)}</span>
                      </div>
                      {transfer && <progress className="progress progress-primary mt-2 w-full" value={transfer.percent} max="1" />}
                    </div>
                  )}
                  {!msg.deletedAt && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {Object.entries(reactionCounts).map(([emoji, count]) => (
                        <button key={emoji} type="button" className={`badge h-6 cursor-pointer gap-1 ${activeReactions.some(reaction => reaction.emoji === emoji && reaction.authorUserId === selfUserId) ? 'badge-primary' : 'badge-outline border-base-300 bg-base-100'}`} onClick={() => void onToggleReaction(msg.id, emoji)}>
                          {emoji} {count}
                        </button>
                      ))}
                      <span className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {['👍', '❤️', '😂', '🎉'].map(emoji => (
                          <button key={emoji} type="button" className="btn btn-ghost btn-xs btn-square" onClick={() => void onToggleReaction(msg.id, emoji)} aria-label={tr('React {emoji}', { emoji })}>{emoji}</button>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex shrink-0 gap-2 border-t border-base-300/70 p-3"
        onSubmit={e => void submit(e)}
        data-testid="global-dm-compose"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          data-testid="global-dm-file-input"
          onChange={event => {
            const files = Array.from(event.target.files ?? [])
            if (files.length) void onFiles(files)
            event.target.value = ''
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={() => fileInputRef.current?.click()} aria-label={tr('Attach files')} data-testid="global-dm-attach">
          <Icon name="paperclip" size={17} />
        </button>
        <input
          type="text"
          className="input input-bordered input-sm min-w-0 flex-1"
          placeholder={tr('Message…')}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          maxLength={4000}
          data-testid="global-dm-input"
          disabled={busy}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || !draft.trim()}
          data-testid="global-dm-send"
        >
          {tr('Send')}
        </button>
      </form>
    </section>
  )
}
