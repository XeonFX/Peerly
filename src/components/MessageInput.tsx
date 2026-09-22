import { buildReplyMessage } from '@peerly/core'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { filesFromClipboard } from '../utils/composerFiles'
import { useI18n } from '../i18n'

type Props = {
  channelName?: string
  isDirectMessage?: boolean
  onSend: (text: string) => void
  onFiles: (files: File[]) => void
  disabled?: boolean
  replyTarget?: { id: string; author: string; text: string } | null
  onCancelReply?: () => void
}

export function MessageInput({
  channelName = 'channel',
  isDirectMessage = false,
  onSend,
  onFiles,
  disabled,
  replyTarget,
  onCancelReply,
}: Props) {
  const { tr } = useI18n()
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const dragDepthRef = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (replyTarget) textRef.current?.focus()
  }, [replyTarget])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(replyTarget ? buildReplyMessage(replyTarget.author, replyTarget.text, trimmed) : trimmed)
    setText('')
    onCancelReply?.()
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    if (files.length > 0) onFiles(files)
    e.target.value = ''
  }

  return (
    <form
      className="relative shrink-0 px-3 pb-3 pt-1 sm:px-5 sm:pb-4"
      onSubmit={handleSubmit}
      onDragEnter={event => {
        if (disabled || !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        dragDepthRef.current += 1
        setDragging(true)
      }}
      onDragOver={event => {
        if (disabled || !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={event => {
        event.preventDefault()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDragging(false)
      }}
      onDrop={event => {
        event.preventDefault()
        dragDepthRef.current = 0
        setDragging(false)
        if (disabled) return
        const files = [...event.dataTransfer.files]
        if (files.length > 0) onFiles(files)
      }}
      data-testid="message-composer"
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 top-1 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/15 text-sm font-semibold text-primary backdrop-blur sm:inset-x-5 sm:bottom-4">
          {tr('Drop files to share')}
        </div>
      )}
      {replyTarget && (
        <div className="mb-1 flex items-center gap-2 rounded-xl border border-base-300 bg-base-200/80 px-3 py-1.5 text-xs">
          <Icon name="reply" size={14} className="text-primary" />
          <span className="min-w-0 flex-1 truncate">
            <strong>{tr('Replying to {name}', { name: replyTarget.author })}</strong>
            {' · '}
            <span className="text-base-content/60">{replyTarget.text}</span>
          </span>
          <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={onCancelReply} aria-label={tr('Cancel reply')}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5 rounded-2xl border border-base-300 bg-base-200/80 p-1.5 backdrop-blur transition-colors focus-within:border-primary/60">
        <input
          id="message-file-attachments"
          name="messageAttachments"
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={handleFile}
          data-testid="file-input"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle shrink-0"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title={tr('Attach a file to share with everyone in this channel')}
          aria-label={tr('Attach file')}
          data-testid="attach-file-button"
        >
          <Icon name="paperclip" />
        </button>
        <input
          ref={textRef}
          id="message-text"
          name="messageText"
          type="text"
          // min-w-0 matters: without it the flex item refuses to shrink and the
          // send button gets pushed off a narrow screen.
          className="min-w-0 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-base-content/55 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={
            isDirectMessage
              ? tr('Message {channel}', { channel: channelName })
              : tr('Message #{channel}', { channel: channelName })
          }
          value={text}
          onChange={e => setText(e.target.value)}
          onPaste={event => {
            if (disabled) return
            const files = filesFromClipboard(event.clipboardData)
            if (files.length === 0) return
            event.preventDefault()
            onFiles(files)
          }}
          disabled={disabled}
          data-testid="message-input"
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm shrink-0 rounded-xl px-4"
          disabled={disabled || !text.trim()}
          data-testid="send-button"
        >
          {tr('Send')}
        </button>
      </div>
    </form>
  )
}
