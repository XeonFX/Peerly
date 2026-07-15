import { useEffect, useMemo, useRef } from 'react'
import type { Message, Peer, UserProfile } from '../types'
import { formatBytes, formatTime } from '../utils/format'
import { isInlineImageType } from '../utils/fileType'
import { buildSenderDirectory, resolveSenderInfo } from '../utils/senderDirectory'
import { Avatar } from './Avatar'

type Props = {
  messages: Message[]
  selfId: string
  selfProfile: UserProfile
  peers: Peer[]
}

// Not `mime.startsWith('image/')`: that matches image/svg+xml, which is a
// script-capable document, not an image. See utils/fileType.
const isImage = isInlineImageType

export function MessageList({ messages, selfId, selfProfile, peers }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const senderDirectory = useMemo(
    () => buildSenderDirectory(selfId, selfProfile, peers, messages),
    [selfId, selfProfile, peers, messages]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <div className="empty-state">
          <span className="empty-icon">💬</span>
          <h3>Start the conversation</h3>
          <p>Messages are sent directly peer-to-peer. No server stores your data.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map(msg => {
        const sender = resolveSenderInfo(msg, senderDirectory, peers)

        return (
          <div key={msg.id} className="message" data-testid="chat-message">
            <div className="message-avatar">
              <Avatar name={sender.name} color={sender.color} avatar={sender.avatar} />
            </div>
            <div className="message-content">
              <div className="message-meta">
                <span className="sender-name">{sender.name}</span>
                <span className="message-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="message-body">
                {msg.type === 'text' ? (
                  <p>{msg.text}</p>
                ) : msg.file ? (
                  <div className="file-message">
                    {isImage(msg.file.mimeType) ? (
                      <a href={msg.file.url} target="_blank" rel="noreferrer">
                        <img src={msg.file.url} alt={msg.file.name} className="file-preview" />
                      </a>
                    ) : (
                      <a href={msg.file.url} download={msg.file.name} className="file-download">
                        <span className="file-icon">📎</span>
                        <span className="file-info">
                          <strong>{msg.file.name}</strong>
                          <span>{formatBytes(msg.file.size)}</span>
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