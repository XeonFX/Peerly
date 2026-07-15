import { useState } from 'react'

type Props = {
  /** Link granting access to the current allow-list. Anyone may share it. */
  inviteLink: string
  /**
   * Whether this device can add people. Only the creator's device holds the key
   * that signs an allow-list peers accept — see WorkspaceAuthManager.canInvite.
   */
  canInvite: boolean
  onInvite: (emails: string[]) => Promise<void>
}

export function InvitePeople({ inviteLink, canInvite, onInvite }: Props) {
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
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="invite-people">
      <button
        type="button"
        className="btn-copy-invite"
        data-testid="copy-invite"
        onClick={() => void copyLink()}
        title="Copy the invite link for people already invited"
      >
        {copied ? 'Invite link copied' : 'Copy invite link'}
      </button>

      {/* Sharing the link is open to everyone — it only admits people already on
          the signed list. Adding someone new needs the creator's signing key. */}
      {canInvite && !open && (
        <button
          type="button"
          className="btn-invite-people"
          data-testid="invite-people-toggle"
          onClick={() => setOpen(true)}
        >
          Invite people…
        </button>
      )}

      {canInvite && open && (
        <form className="invite-form" onSubmit={submit}>
          <label>
            <span>Emails to invite</span>
            <input
              type="text"
              placeholder="carol@company.com, dan@company.com"
              value={emails}
              onChange={e => setEmails(e.target.value)}
              data-testid="invite-emails"
              autoFocus
            />
          </label>
          <div className="invite-form-actions">
            <button type="submit" className="btn-primary" disabled={busy} data-testid="invite-submit">
              {busy ? 'Inviting…' : 'Add to workspace'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              Cancel
            </button>
          </div>
          <p className="invite-hint">
            They'll appear in the invite link immediately — copy it and send it to them.
          </p>
        </form>
      )}

      {!canInvite && (
        <p className="invite-hint" data-testid="invite-creator-only">
          Only the workspace creator can add people, from the device they created it on. Share the
          invite link with anyone already invited.
        </p>
      )}

      {error && (
        <p className="invite-error" data-testid="invite-error">
          {error}
        </p>
      )}
    </div>
  )
}
