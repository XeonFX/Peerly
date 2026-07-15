import { useRef, useState } from 'react'

type Props = {
  channelName?: string
  isDirectMessage?: boolean
  onSend: (text: string) => void
  onFile: (file: File) => void
  disabled?: boolean
}

export function MessageInput({
  channelName = 'channel',
  isDirectMessage = false,
  onSend,
  onFile,
  disabled,
}: Props) {
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''
  }

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={handleFile}
        data-testid="file-input"
      />
      <button
        type="button"
        className="btn-attach"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        title="Attach a file to share with everyone in this channel"
        aria-label="Attach file"
        data-testid="attach-file-button"
      >
        <span className="attach-icon" aria-hidden="true">
          📎
        </span>
        <span className="attach-label">Attach</span>
      </button>
      <input
        type="text"
        placeholder={isDirectMessage ? `Message ${channelName}` : `Message #${channelName}`}
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={disabled}
        data-testid="message-input"
      />
      <button
        type="submit"
        className="btn-send"
        disabled={disabled || !text.trim()}
        data-testid="send-button"
      >
        Send
      </button>
    </form>
  )
}