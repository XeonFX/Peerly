import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useI18n } from '../i18n'

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

/**
 * Invite controls, collapsed into a footer popover. Sharing/inviting is an
 * occasional action, so keeping it behind one button leaves the online-members
 * list above it the vertical space it needs on short/narrow windows (an
 * always-open panel here used to squeeze that list to nothing).
 */
export function InvitePeople({
  inviteLink,
  invitedEmails,
  canInvite,
  onInvite,
  onRemove,
  selfEmail,
}: Props) {
  const { tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [emails, setEmails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /** Popover expansion (separate from the add-people form's `open`). */
  const [panelOpen, setPanelOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close the popover on outside click or Escape.
  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [panelOpen])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(tr('Could not copy — copy the link from the address bar after joining'))
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = emails
      .split(/[,\s]+/)
      .map(email => email.trim())
      .filter(Boolean)

    if (parsed.length === 0) {
      setError(tr('Enter at least one email address'))
      return
    }
    const invalid = parsed.filter(email => !email.includes('@'))
    if (invalid.length > 0) {
      setError(tr('Not an email address: {email}', { email: invalid[0] }))
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
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="btn btn-outline btn-sm w-full justify-between"
        data-testid="invite-panel-toggle"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen(value => !value)}
      >
        <span className="flex items-center gap-2">
          <Icon name="plus" size={15} />
          {tr('Invite people')}
          {invitedEmails.length > 0 && (
            <span className="text-base-content/50">({invitedEmails.length})</span>
          )}
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className={`transition-transform ${panelOpen ? '' : 'rotate-180'}`}
        />
      </button>

      {panelOpen && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-2 flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-3 shadow-xl">
          {invitedEmails.length > 0 && (
            <div className="rounded-box border border-base-300/80 bg-base-200/60 px-2.5 py-2">
              <p className="mb-1.5 text-xs font-medium text-base-content/70">
                {tr('Invite people')} ({invitedEmails.length})
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
                        title={tr('Remove from the invite list. Members who receive the update stop admitting them at their next connection.')}
                        aria-label={tr('Remove {email}', { email })}
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

          {/* Primary action — sharing the link is how anyone else gets in. */}
          <button
            type="button"
            className={`btn btn-sm w-full ${copied ? 'btn-success' : 'btn-primary'}`}
            data-testid="copy-invite"
            onClick={() => void copyLink()}
            title={tr('Copy the invite link for people already invited')}
          >
            {copied ? <><Icon name="check" size={16} /> {tr('Invite link copied')}</> : tr('Copy invite link')}
          </button>

          {/* Sharing the link is open to everyone — it only admits people already
              on the signed list. Adding someone new needs the creator's key. */}
          {canInvite && !open && (
            <button
              type="button"
              className="btn btn-outline btn-sm w-full"
              data-testid="invite-people-toggle"
              onClick={() => setOpen(true)}
            >
              {tr('Invite people')}…
            </button>
          )}

          {canInvite && open && (
            <form className="flex flex-col gap-2" onSubmit={submit}>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-base-content/70">
                  {tr('Emails to invite')}
                </span>
                <input
                  id="invite-member-emails"
                  name="inviteMemberEmails"
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
                  {busy ? `${tr('Inviting')}…` : tr('Add')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setOpen(false)
                    setError(null)
                  }}
                >
                  {tr('Cancel')}
                </button>
              </div>
              <p className="text-[0.65rem] leading-relaxed text-base-content/50">
                {tr("They'll appear in the invite link immediately — copy it and send it to them.")}
              </p>
            </form>
          )}

          {!canInvite && (
            <p
              className="text-[0.65rem] leading-relaxed text-base-content/45"
              data-testid="invite-creator-only"
            >
              {tr('Only the creator can add people, from the device they created the workspace on. Share the link above with anyone already invited.')}
            </p>
          )}

          {error && (
            <p className="text-[0.68rem] text-error" data-testid="invite-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
