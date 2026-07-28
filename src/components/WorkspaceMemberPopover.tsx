import { useEffect, useState, type FormEvent } from 'react'
import type { Peer, UserProfile } from '../types'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { useI18n } from '../i18n'

export type WorkspaceMemberSelection =
  | { kind: 'self'; profile: UserProfile }
  | {
      kind: 'peer'
      peer: Peer
      contact?: { userId: string; email: string; name: string }
      friend: boolean
      canMessage: boolean
      subtitle?: string
    }

type Props = {
  member: WorkspaceMemberSelection | null
  onClose: () => void
  onEditProfile: () => void
  onRequestFriend: (
    contact: { userId: string; email: string; name: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onSendMessage: (userId: string, text: string) => void
}

/**
 * Discord-style member card: clicking a workspace member opens one focused
 * surface for identity details and the next safe action. Workspace chat does
 * not create a second DM system; messages hand off to the global friend DM.
 */
export function WorkspaceMemberPopover({
  member,
  onClose,
  onEditProfile,
  onRequestFriend,
  onSendMessage,
}: Props) {
  const { tr } = useI18n()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!member) return
    setDraft('')
    setError(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [member, onClose])

  if (!member) return null

  const self = member.kind === 'self'
  const profile = self ? member.profile : member.peer
  const contact = self ? undefined : member.contact

  const requestFriend = async () => {
    if (!contact || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onRequestFriend(contact)
      if (!result.ok) setError(result.error)
      else setError(tr('Friend request sent. You can message after they accept.'))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (member.kind !== 'peer' || !member.canMessage || !contact || !draft.trim()) return
    onSendMessage(contact.userId, draft.trim())
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
      data-testid="workspace-member-popover-backdrop"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-member-name"
        className="w-full max-w-sm rounded-2xl border border-base-300 bg-base-100 p-5 shadow-2xl"
        data-testid="workspace-member-popover"
      >
        <div className="flex items-start gap-4">
          <Avatar
            name={profile.name}
            color={profile.color}
            avatar={profile.avatar}
            size="lg"
            shape="circle"
          />
          <div className="min-w-0 flex-1 pt-1">
            <h2 id="workspace-member-name" className="truncate text-lg font-bold">
              {profile.name}
            </h2>
            {self ? (
              <p className="text-xs text-base-content/55">{tr('This is you')}</p>
            ) : (
              <>
                {contact?.email && (
                  <p className="truncate text-xs text-base-content/60" title={contact.email}>{contact.email}</p>
                )}
                <p className="mt-0.5 text-xs text-base-content/55">
                  {member.subtitle
                    ? tr(member.subtitle)
                    : member.peer.presenceOnly
                      ? tr('Connecting secure identity…')
                      : tr('Workspace member')}
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square -mr-2 -mt-2"
            onClick={onClose}
            aria-label={tr('Close')}
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        {self ? (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-6 w-full"
              onClick={() => {
                onClose()
                onEditProfile()
              }}
              data-testid="workspace-member-edit-profile"
            >
              <Icon name="pencil" size={15} />
              {tr('Edit profile')}
            </button>
          ) : member.canMessage && contact ? (
            <form className="mt-6 flex items-center gap-2 rounded-xl border border-base-300 bg-base-200/60 p-1.5 focus-within:border-primary/60" onSubmit={submit}>
              <input
                type="text"
                className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                placeholder={tr('Message {name}', { name: profile.name })}
                maxLength={4000}
                autoFocus
                data-testid="workspace-member-message-input"
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm btn-circle"
                disabled={!draft.trim()}
                aria-label={tr('Send message')}
                data-testid="workspace-member-message-send"
              >
                <Icon name="message-circle" size={15} />
              </button>
            </form>
          ) : contact ? (
            <div className="mt-6">
              <button
                type="button"
                className="btn btn-primary btn-sm w-full"
                onClick={() => void requestFriend()}
                disabled={busy}
                data-testid="workspace-member-add-friend"
              >
                <Icon name="plus" size={15} />
                {tr(member.friend ? 'Enable secure messages' : 'Send friend request')}
              </button>
              <p className="mt-2 text-xs leading-relaxed text-base-content/55">
                {tr('Global direct messages become available after they accept your request.')}
              </p>
            </div>
          ) : (
            <p className="mt-6 rounded-lg bg-base-200 px-3 py-2 text-xs text-base-content/60">
              {tr('Secure profile details are still connecting.')}
            </p>
          )}

        {error && (
            <p className="mt-3 text-xs text-base-content/65" role="status">
              {error}
            </p>
          )}
      </section>
    </div>
  )
}
