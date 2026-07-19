import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { GlobalDmMessage } from '../collab/globalDmHistory'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

type Props = {
  friendName: string
  friendEmail?: string
  friendOnline: boolean
  partnerInRoom: boolean
  messages: GlobalDmMessage[]
  selfUserId: string
  error: string | null
  onSend: (text: string) => Promise<void>
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
  onSend,
  onClose,
}: Props) {
  const { tr } = useI18n()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

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
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-base-content/50">
            {tr('No messages yet. Say hello — they will get a ring if they are online.')}
          </p>
        ) : (
          messages.map(msg => {
            const mine = msg.authorUserId === selfUserId
            const body = msg.deletedAt ? tr('Message deleted') : msg.text
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
                  <p className={msg.deletedAt ? 'italic opacity-70' : 'whitespace-pre-wrap break-words'}>
                    {body}
                  </p>
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
