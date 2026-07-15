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
    <form className="shrink-0 px-3 pb-3 pt-1 sm:px-5 sm:pb-4" onSubmit={handleSubmit}>
      <div className="flex items-center gap-1.5 rounded-2xl border border-base-300 bg-base-200/80 p-1.5 backdrop-blur transition-colors focus-within:border-primary/60">
        <input ref={fileRef} type="file" hidden onChange={handleFile} data-testid="file-input" />
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle shrink-0"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title="Attach a file to share with everyone in this channel"
          aria-label="Attach file"
          data-testid="attach-file-button"
        >
          <span aria-hidden="true">📎</span>
        </button>
        <input
          type="text"
          // min-w-0 matters: without it the flex item refuses to shrink and the
          // send button gets pushed off a narrow screen.
          className="min-w-0 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-base-content/35 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={isDirectMessage ? `Message ${channelName}` : `Message #${channelName}`}
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={disabled}
          data-testid="message-input"
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm shrink-0 rounded-xl px-4"
          disabled={disabled || !text.trim()}
          data-testid="send-button"
        >
          Send
        </button>
      </div>
    </form>
  )
}