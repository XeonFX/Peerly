import { useState } from 'react'
import { Icon } from './Icon'

type Props = {
  /** Link granting access to the current allow-list. Anyone may share it. */
  inviteLink: string
  /** Emails on the creator-signed allow-list — who can join via the invite link. */
  invitedEmails: string[]
  /**
   * Whether this device can add people. Only the creator's device holds the key
   * that signs an allow-list peers accept — see WorkspaceAuthManager.canInvite.
   */
  canInvite: boolean
  onInvite: (emails: string[]) => Promise<void>
  /**
   * Creator-only, like inviting. Removal is honest about its limits: members
   * who receive the re-signed list stop admitting the removed member at their
   * next handshake; the removed member and anyone who never saw the update can
   * still pair, and open connections are not torn down.
   */
  onRemove?: (email: string) => Promise<void>
  /** The signed-in member's own email — the creator cannot remove themselves. */
  selfEmail?: string
}

export function InvitePeople({ inviteLink, invitedEmails, canInvite, onInvite, onRemove, selfEmail }: Props) {
  const [open, setOpen] = useState(false)
  const [emails, setEmails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy — copy the link from the address bar after joining')
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = emails
      .split(/[,\s]+/)
      .map(email => email.trim())
      .filter(Boolean)

    if (parsed.length === 0) {
      setError('Enter at least one email address')
      return
    }
    const invalid = parsed.filter(email => !email.includes('@'))
    if (invalid.length > 0) {
      setError(`Not an email address: ${invalid[0]}`)
      return
    }

    setError(null)
    setBusy(true)
    try {
      await onInvite(parsed)
      setEmails('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {invitedEmails.length > 0 && (
        <div className="rounded-box border border-base-300/80 bg-base-200/60 px-2.5 py-2">
          <p className="mb-1.5 text-xs font-medium text-base-content/70">
            Invited members ({invitedEmails.length})
          </p>
          <ul
            className="max-h-28 space-y-0.5 overflow-y-auto text-[0.7rem] leading-relaxed text-base-content/80"
            data-testid="invited-members"
          >
            {invitedEmails.map(email => (
              <li
                key={email}
                className="group/member flex items-center gap-1"
                data-testid={`invited-${email}`}
              >
                <span className="min-w-0 flex-1 truncate font-mono">{email}</span>
                {canInvite && onRemove && email.toLowerCase() !== selfEmail?.toLowerCase() && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square shrink-0 text-base-content/30 opacity-0 transition-opacity hover:text-error group-hover/member:opacity-100 focus-visible:opacity-100"
                    title="Remove from the invite list. Members who receive the update stop admitting them at their next connection."
                    aria-label={`Remove ${email}`}
                    data-testid={`remove-member-${email}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${email}? Members who receive the update will stop admitting them when they next connect. Anyone still holding the old list, including ${email}, may still pair until updated.`
                        )
                      ) {
                        void onRemove(email).catch(err =>
                          setError(err instanceof Error ? err.message : String(err))
                        )
                      }
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* This is the primary action in the footer — sharing the link is how
          anyone else gets in. It previously rendered as unstyled text, which
          read as disabled. */}
      <button
        type="button"
        className={`btn btn-sm w-full ${copied ? 'btn-success' : 'btn-primary'}`}
        data-testid="copy-invite"
        onClick={() => void copyLink()}
        title="Copy the invite link for people already invited"
      >
        {copied ? <><Icon name="check" size={16} /> Invite link copied</> : 'Copy invite link'}
      </button>

      {/* Sharing the link is open to everyone — it only admits people already on
          the signed list. Adding someone new needs the creator's signing key. */}
      {canInvite && !open && (
        <button
          type="button"
          className="btn btn-outline btn-sm w-full"
          data-testid="invite-people-toggle"
          onClick={() => setOpen(true)}
        >
          Invite people…
        </button>
      )}

      {canInvite && open && (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-base-content/70">
              Emails to invite
            </span>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              placeholder="carol@company.com"
              value={emails}
              onChange={e => setEmails(e.target.value)}
              data-testid="invite-emails"
              autoFocus
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn btn-primary btn-sm flex-1"
              disabled={busy}
              data-testid="invite-submit"
            >
              {busy ? 'Inviting…' : 'Add'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              Cancel
            </button>
          </div>
          <p className="text-[0.65rem] leading-relaxed text-base-content/50">
            They'll appear in the invite link immediately — copy it and send it to them.
          </p>
        </form>
      )}

      {!canInvite && (
        <p
          className="text-[0.65rem] leading-relaxed text-base-content/45"
          data-testid="invite-creator-only"
        >
          Only the creator can add people, from the device they created the workspace on. Share the
          link above with anyone already invited.
        </p>
      )}

      {error && (
        <p className="text-[0.68rem] text-error" data-testid="invite-error">
          {error}
        </p>
      )}
    </div>
  )
}
