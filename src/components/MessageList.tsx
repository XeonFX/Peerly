import { useEffect, useMemo, useRef } from 'react'
import type { Message, Peer, UserProfile } from '../types'
import { formatBytes, formatTime } from '../utils/format'
import { isInlineImageType } from '../utils/fileType'
import { buildSenderDirectory, resolveSenderInfo } from '../utils/senderDirectory'
import { Avatar } from './Avatar'

type Props = {
  messages: Message[]
  selfId: string
  /** Past sessions' ids for this workspace — our old messages carry them. */
  pastSelfIds?: string[]
  selfProfile: UserProfile
  peers: Peer[]
}

// Not `mime.startsWith('image/')`: that matches image/svg+xml, which is a
// script-capable document, not an image. See utils/fileType.
const isImage = isInlineImageType

export function MessageList({ messages, selfId, pastSelfIds = [], selfProfile, peers }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const senderDirectory = useMemo(
    () => buildSenderDirectory(selfId, selfProfile, peers, messages, pastSelfIds),
    [selfId, selfProfile, peers, messages, pastSelfIds]
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
                    {isImage(msg.file.mimeType) ? (
                      <a href={msg.file.url} target="_blank" rel="noreferrer">
                        <img
                          src={msg.file.url}
                          alt={msg.file.name}
                          className="file-preview max-h-64 max-w-full rounded-lg border border-base-300"
                        />
                      </a>
                    ) : (
                      <a
                        href={msg.file.url}
                        download={msg.file.name}
                        className="file-download inline-flex items-center gap-2.5 rounded-lg border border-base-300 bg-base-200 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-base-300"
                      >
                        <span aria-hidden="true">📎</span>
                        <span className="flex min-w-0 flex-col">
                          <strong className="truncate text-sm font-medium">{msg.file.name}</strong>
                          <span className="text-xs text-base-content/50">
                            {formatBytes(msg.file.size)}
                          </span>
                        </span>
                      </a>
                    )}
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