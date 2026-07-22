import { useEffect, useMemo, useState } from 'react'
import { useAccessibleDialog } from '@peerly/core/react'
import type { Channel, Message, Peer, UserProfile } from '../types'
import { buildSenderDirectory, resolveSenderInfo } from '../utils/senderDirectory'
import { formatTime } from '../utils/format'
import { MIN_SEARCH_QUERY, searchMessages } from '../utils/messageSearch'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { useI18n } from '../i18n'

type Props = {
  open: boolean
  channels: Channel[]
  messagesByChannel: Record<string, Message[]>
  peers: Peer[]
  selfProfile: UserProfile
  selfId: string
  selfUserId?: string
  pastSelfIds: string[]
  /** Switch to a channel (the result's home) and close the search. */
  onJump: (channelId: string) => void
  onClose: () => void
}

/**
 * Workspace-wide message search. Text-only, client-side over the in-memory
 * history of every channel — there is no server index. Selecting a result jumps
 * to that channel (scroll-to-exact-message is intentionally out of scope for v1).
 */
export function MessageSearch({
  open,
  channels,
  messagesByChannel,
  peers,
  selfProfile,
  selfId,
  selfUserId,
  pastSelfIds,
  onJump,
  onClose,
}: Props) {
  const { tr } = useI18n()
  const [query, setQuery] = useState('')
  const dialogRef = useAccessibleDialog(open, onClose)

  useEffect(() => {
    if (!open) return
    setQuery('')
  }, [open])

  const directory = useMemo(() => {
    if (!open) return {}
    const all = Object.values(messagesByChannel).flat()
    return buildSenderDirectory(selfId, selfProfile, peers, all, pastSelfIds, selfUserId)
  }, [open, messagesByChannel, selfId, selfProfile, peers, pastSelfIds, selfUserId])

  const channelLabel = (channel: Channel): string =>
    channel.kind === 'dm'
      ? peers.find(peer => peer.id === channel.peerId)?.name ?? channel.name
      : `#${channel.name}`

  const results = useMemo(
    () => searchMessages(channels, messagesByChannel, query),
    [query, channels, messagesByChannel]
  )

  if (!open) return null

  const tooShort = query.trim().length < MIN_SEARCH_QUERY

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={tr('Search messages')}
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3">
          <Icon name="search" size={18} className="text-base-content/50" />
          <input
            type="text"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder={tr('Search messages')}
            value={query}
            onChange={event => setQuery(event.target.value)}
            data-testid="message-search-input"
          />
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            onClick={onClose}
            aria-label={tr('Close')}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="message-search-results">
          {tooShort ? (
            <p className="px-4 py-6 text-center text-sm text-base-content/50">
              {tr('Type at least two characters to search this workspace.')}
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-base-content/50">{tr('No matches')}</p>
          ) : (
            <ul className="divide-y divide-base-300/60">
              {results.map(({ channel, message }) => {
                const sender = resolveSenderInfo(message, directory, peers)
                return (
                  <li key={`${channel.id}:${message.id}`}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-base-content/5"
                      onClick={() => {
                        onJump(channel.id)
                        onClose()
                      }}
                    >
                      <Avatar name={sender.name} color={sender.color} avatar={sender.avatar} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-xs text-base-content/60">
                          <span className="font-medium text-base-content/80">{sender.name}</span>
                          <span className="truncate">{channelLabel(channel)}</span>
                          <span className="ml-auto shrink-0">{formatTime(message.timestamp)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-base-content/90">
                          {message.text}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
