import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { buildReplyMessage, formatMessageTimestamp, groupConsecutiveMessages } from '@peerly/core'
import { useClockFormat } from '@peerly/core/react'
import type { GlobalDmMessage } from '../collab/globalDmHistory'
import type { GlobalDmReaction } from '../collab/globalDmHistory'
import type { GlobalDmTransfer } from '../hooks/useGlobalDmChat'
import { useI18n } from '../i18n'
import { isInlineImageType, isInlineVideoType } from '../utils/fileType'
import { safeThumbnailUrl } from '../utils/avatarUrl'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { SafeMessageText } from './SafeMessageText'
import { formatBytes } from '../utils/format'
import type { UserProfile } from '../types'
import { MessageActions } from './MessageActions'
import { scrollToLinkedMessage } from '../utils/messageLink'
import {
  WorkspaceMemberPopover,
  type WorkspaceMemberSelection,
} from './WorkspaceMemberPopover'

type Props = {
  friendName: string
  friendUserId: string
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
  onEditProfile: () => void
}

/**
 * Active global friend DM pane (home view). Transport lives in useGlobalDmChat.
 */
export function GlobalDmChat({
  friendName,
  friendUserId,
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
  onEditProfile,
}: Props) {
  const { locale, tr } = useI18n()
  const { clockFormat, dateFormat } = useClockFormat()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; text: string } | null>(null)
  const [openActionsId, setOpenActionsId] = useState<string | null>(null)
  const [selectedMember, setSelectedMember] = useState<WorkspaceMemberSelection | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const visibleMessages = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase()
    if (!needle) return messages
    return messages.filter(message =>
      `${message.text} ${message.attachment?.name ?? ''} ${message.name}`.toLocaleLowerCase().includes(needle)
    )
  }, [messages, searchQuery])
  const presentedMessages = useMemo(
    () =>
      groupConsecutiveMessages(visibleMessages, {
        authorId: message => message.authorUserId ?? message.deviceKeyId,
        timestamp: message => message.ts,
      }).flatMap(group =>
        group.messages.map((message, index) => ({
          message,
          startsDay: group.startsDay,
          startsGroup: index === 0,
        }))
      ),
    [visibleMessages]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    scrollToLinkedMessage()
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

  const friendMember: WorkspaceMemberSelection = {
    kind: 'peer',
    peer: {
      id: friendUserId,
      userId: friendUserId,
      name: friendName,
      color: '#5865f2',
    },
    contact: friendEmail
      ? { userId: friendUserId, email: friendEmail, name: friendName }
      : undefined,
    friend: true,
    canMessage: true,
    subtitle: 'Friend',
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      await onSend(replyTarget ? buildReplyMessage(replyTarget.author, replyTarget.text, draft) : draft)
      setDraft('')
      setReplyTarget(null)
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
        <button
          type="button"
          className="rounded-md outline-none ring-primary/45 focus-visible:ring-2"
          onClick={() => setSelectedMember(friendMember)}
          aria-label={tr('Open {name} profile', { name: friendName })}
          data-testid="global-dm-header-avatar"
        >
          <Avatar name={friendName} color="#5865f2" size="sm" />
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
          presentedMessages.map(({ message: msg, startsDay, startsGroup }) => {
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
                id={`message-${msg.id}`}
                className={`chat-message-row group relative flex gap-3 rounded-lg px-2 transition-colors hover:bg-base-300/80 focus-within:bg-base-300/80 ${
                  openActionsId === msg.id ? 'bg-base-300/80 ring-1 ring-inset ring-base-content/10' : ''
                } ${
                  startsGroup ? 'mt-1 py-1 first:mt-0' : 'py-0'
                }`}
                data-testid={mine ? 'global-dm-mine' : 'global-dm-theirs'}
                data-message-group-start={startsGroup ? 'true' : 'false'}
                tabIndex={0}
              >
                {startsGroup ? (
                  <button
                    type="button"
                    className="h-10 w-10 shrink-0 rounded-lg outline-none ring-primary/45 focus-visible:ring-2"
                    onClick={() => setSelectedMember(
                      mine
                        ? { kind: 'self', profile: selfProfile }
                        : friendMember
                    )}
                    aria-label={tr('Open {name} profile', { name: senderName })}
                    data-testid="global-dm-avatar"
                  >
                    <Avatar
                      name={senderName}
                      color={mine ? selfProfile.color : '#5865f2'}
                      avatar={mine ? selfProfile.avatar : undefined}
                      size="md"
                    />
                  </button>
                ) : (
                  <span className="w-10 shrink-0" aria-hidden="true" />
                )}
                <div className="relative min-w-0 flex-1">
                  {startsGroup && (
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-semibold text-base-content">{senderName}</span>
                      <time
                        className="shrink-0 text-[0.7rem] text-base-content/60"
                        dateTime={new Date(msg.ts).toISOString()}
                        data-testid="global-dm-time"
                      >
                        {formatMessageTimestamp(msg.ts, {
                          clockFormat,
                          dateFormat,
                          includeDate: startsDay,
                          locale,
                        })}
                      </time>
                    </div>
                  )}
                  {(msg.deletedAt || body) && (
                    <div className="text-sm leading-relaxed text-base-content/90">
                      {msg.deletedAt
                        ? <p className="italic text-base-content/65">{body}</p>
                        : <SafeMessageText text={body} />}
                      {msg.editedAt && !msg.deletedAt && (
                        <span className="ml-1 text-[0.65rem] text-base-content/65">{tr('edited')}</span>
                      )}
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
                  {!msg.deletedAt && Object.keys(reactionCounts).length > 0 && (
                    <div
                      className="mt-0.5 flex flex-wrap items-center gap-1"
                      data-testid="global-dm-reactions"
                    >
                      {Object.entries(reactionCounts).map(([emoji, count]) => (
                        <button key={emoji} type="button" className={`badge h-6 cursor-pointer gap-1 ${activeReactions.some(reaction => reaction.emoji === emoji && reaction.authorUserId === selfUserId) ? 'badge-primary' : 'badge-outline border-base-300 bg-base-100'}`} onClick={() => void onToggleReaction(msg.id, emoji)}>
                          {emoji} {count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!msg.deletedAt && (
                  <MessageActions
                    messageId={msg.id}
                    text={msg.text}
                    canEdit={mine && !attachment}
                    canDelete={mine}
                    onReact={emoji => void onToggleReaction(msg.id, emoji)}
                    onReply={() => setReplyTarget({ id: msg.id, author: senderName, text: msg.text })}
                    onEdit={() => {
                      const next = window.prompt(tr('Edit message'), msg.text)?.trim()
                      if (next && next !== msg.text) onEdit(msg.id, next)
                    }}
                    onDelete={() => {
                      if (window.confirm(tr('Delete this message for everyone online?'))) {
                        onDelete(msg.id)
                      }
                    }}
                    onOpenChange={open =>
                      setOpenActionsId(current => open ? msg.id : current === msg.id ? null : current)
                    }
                    testIdPrefix="global-dm-message"
                  />
                )}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="shrink-0 border-t border-base-300/70 p-3"
        onSubmit={e => void submit(e)}
        data-testid="global-dm-compose"
      >
        {replyTarget && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-base-200 px-3 py-1.5 text-xs">
            <Icon name="reply" size={14} className="text-primary" />
            <span className="min-w-0 flex-1 truncate">
              <strong>{tr('Replying to {name}', { name: replyTarget.author })}</strong>
              {' · '}
              <span className="text-base-content/60">{replyTarget.text}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={() => setReplyTarget(null)} aria-label={tr('Cancel reply')}>
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
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
        </div>
      </form>
      <WorkspaceMemberPopover
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
        onEditProfile={() => {
          setSelectedMember(null)
          onEditProfile()
        }}
        onRequestFriend={async () => ({ ok: true })}
        onSendMessage={(_, text) => void onSend(text)}
      />
    </section>
  )
}
