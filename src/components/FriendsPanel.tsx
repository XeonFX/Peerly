import { useState, type FormEvent } from 'react'
import type { Friend } from '../collab/friendsStore'
import type { IncomingFriendInvite, OutgoingFriendInvite } from '../collab/friendInviteStore'
import { Icon } from './Icon'
import { useI18n } from '../i18n'

type Props = {
  friends: Friend[]
  outgoing: OutgoingFriendInvite[]
  incoming: IncomingFriendInvite[]
  onlineCount: number
  onInvite: (email: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onAccept: (inviteId: string) => Promise<boolean>
  onDecline: (inviteId: string) => Promise<boolean>
  onCancelOutgoing: (inviteId: string) => void
  onRemoveFriend: (userId: string) => void
}

/**
 * Friends list + email invite form for the home (picker) view.
 * Delivery is presence-based: the invite reaches the other person only when
 * they are online on the Peerly lobby mesh with a matching signed-in email.
 */
export function FriendsPanel({
  friends,
  outgoing,
  incoming,
  onlineCount,
  onInvite,
  onAccept,
  onDecline,
  onCancelOutgoing,
  onRemoveFriend,
}: Props) {
  const { tr } = useI18n()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const result = await onInvite(email)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEmail('')
      setNotice(tr('Invite queued — they will see it when they are online on Peerly.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="rounded-box border border-base-300/80 bg-base-100/80 p-4 shadow-sm"
      data-testid="friends-panel"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-base-content/90">
          {tr('Friends')}
        </h2>
        <span
          className="text-[0.65rem] text-base-content/50"
          data-testid="friends-lobby-online"
          title={tr('People reachable on the friend lobby right now (including you)')}
        >
          {tr('{count} online', { count: onlineCount })}
        </span>
      </div>

      <p className="mb-3 text-xs text-base-content/60">
        {tr(
          'Invite by email. If they are signed in to Peerly with that address, they get the invite over the presence lobby — there is no email mailbox.'
        )}
      </p>

      <form className="mb-4 flex gap-2" onSubmit={e => void submit(e)} data-testid="friend-invite-form">
        <input
          type="email"
          className="input input-bordered input-sm min-w-0 flex-1"
          placeholder={tr('friend@example.com')}
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          data-testid="friend-invite-email"
          disabled={busy}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm shrink-0"
          disabled={busy || !email.trim()}
          data-testid="friend-invite-submit"
        >
          {busy ? tr('Sending…') : tr('Invite')}
        </button>
      </form>

      {error && (
        <p className="mb-2 text-xs text-error" role="alert" data-testid="friend-invite-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-2 text-xs text-success" data-testid="friend-invite-notice">
          {notice}
        </p>
      )}

      {incoming.length > 0 && (
        <div className="mb-4" data-testid="friend-incoming">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-base-content/55">
            {tr('Incoming invites')}
          </h3>
          <ul className="space-y-2">
            {incoming.map(inv => (
              <li
                key={inv.inviteId}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-base-200/60 px-2 py-1.5 text-sm"
                data-testid={`friend-incoming-${inv.inviteId}`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{inv.fromName}</span>
                  <span className="text-base-content/55"> · {inv.payload.fromEmail}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  data-testid={`friend-accept-${inv.inviteId}`}
                  onClick={() => void onAccept(inv.inviteId)}
                >
                  {tr('Accept')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  data-testid={`friend-decline-${inv.inviteId}`}
                  onClick={() => void onDecline(inv.inviteId)}
                >
                  {tr('Decline')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="mb-4" data-testid="friend-outgoing">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-base-content/55">
            {tr('Pending invites')}
          </h3>
          <ul className="space-y-1">
            {outgoing.map(inv => (
              <li
                key={inv.inviteId}
                className="flex items-center gap-2 px-1 py-1 text-sm"
                data-testid={`friend-outgoing-${inv.toEmail}`}
              >
                <Icon name="message-circle" size={14} className="shrink-0 text-base-content/45" />
                <span className="min-w-0 flex-1 truncate text-base-content/80">{inv.toEmail}</span>
                <span className="shrink-0 text-[0.65rem] text-base-content/45">
                  {inv.lastSentAt ? tr('Delivered') : tr('Waiting online…')}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square"
                  title={tr('Cancel invite')}
                  aria-label={tr('Cancel invite')}
                  data-testid={`friend-cancel-${inv.inviteId}`}
                  onClick={() => onCancelOutgoing(inv.inviteId)}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div data-testid="friends-list">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-base-content/55">
          {tr('Your friends')}
        </h3>
        {friends.length === 0 ? (
          <p className="text-xs text-base-content/50">{tr('No friends yet.')}</p>
        ) : (
          <ul className="space-y-1">
            {friends.map(friend => (
              <li
                key={friend.subjectUserId}
                className="flex items-center gap-2 px-1 py-1 text-sm"
                data-testid={`friend-row-${friend.subjectEmail ?? friend.subjectUserId}`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{friend.subjectName}</span>
                  {friend.subjectEmail && (
                    <span className="text-base-content/55"> · {friend.subjectEmail}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square shrink-0"
                  title={tr('Remove friend')}
                  aria-label={tr('Remove friend')}
                  data-testid={`friend-remove-${friend.subjectUserId}`}
                  onClick={() => onRemoveFriend(friend.subjectUserId)}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
