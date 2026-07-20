import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { GlobalDmMessage } from '../collab/globalDmHistory'
import type { GlobalDmReaction } from '../collab/globalDmHistory'
import type { GlobalDmTransfer } from '../hooks/useGlobalDmChat'
import { useI18n } from '../i18n'
import { isInlineImageType, isInlineVideoType } from '../utils/fileType'
import { safeThumbnailUrl } from '../utils/avatarUrl'
import { Icon } from './Icon'

type Props = {
  friendName: string
  friendEmail?: string
  friendOnline: boolean
  partnerInRoom: boolean
  messages: GlobalDmMessage[]
  selfUserId: string
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

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="global-dm-messages">
        {visibleMessages.length === 0 ? (
          <p className="py-8 text-center text-xs text-base-content/50">
            {searchQuery.trim() ? tr('No messages match your search.') : tr('No messages yet. Say hello — they will get a ring if they are online.')}
          </p>
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
            return (
              <div
                key={msg.id}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                data-testid={mine ? 'global-dm-mine' : 'global-dm-theirs'}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${
                    mine
                      ? 'bg-primary text-primary-content'
                      : 'bg-base-200 text-base-content'
                  }`}
                >
                  {!mine && (
                    <div className="mb-0.5 text-[0.65rem] font-medium opacity-70">{msg.name}</div>
                  )}
                  {(msg.deletedAt || body) && (
                    <p className={msg.deletedAt ? 'italic opacity-70' : 'whitespace-pre-wrap break-words'}>
                      {body}
                    </p>
                  )}
                  {!msg.deletedAt && attachment && (
                    <div className="mt-1.5 min-w-48 overflow-hidden rounded-xl border border-current/15 bg-base-100/10 p-2">
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
                      {transfer && <progress className="progress progress-primary mt-2 w-full" value={transfer.percent} max="100" />}
                    </div>
                  )}
                  {mine && !msg.deletedAt && (
                    <div className="mt-1 flex justify-end gap-1 text-[0.65rem] opacity-75">
                      {!attachment && <button type="button" className="hover:underline" onClick={() => {
                        const next = prompt(tr('Edit message'), msg.text)
                        if (next?.trim()) onEdit(msg.id, next)
                      }}>{tr('Edit')}</button>}
                      <button type="button" className="hover:underline" onClick={() => onDelete(msg.id)}>{tr('Delete')}</button>
                    </div>
                  )}
                  {!msg.deletedAt && (
                    <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                      {Object.entries(reactionCounts).map(([emoji, count]) => (
                        <button key={emoji} type="button" className={`badge badge-sm cursor-pointer ${activeReactions.some(reaction => reaction.emoji === emoji && reaction.authorUserId === selfUserId) ? 'badge-primary' : 'badge-outline'}`} onClick={() => void onToggleReaction(msg.id, emoji)}>
                          {emoji} {count}
                        </button>
                      ))}
                      <span className="flex opacity-50 transition-opacity hover:opacity-100">
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
