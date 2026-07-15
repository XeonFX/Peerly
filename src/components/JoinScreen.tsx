import { useEffect, useRef, useState } from 'react'
import { isEmailAllowed } from '../collab/allowList'
import { APP_NAME, appBuildLabel } from '../config'
import {
  decodeInviteFromHash,
  encodeInviteLink,
  type WorkspaceAccess,
  type WorkspaceInvite,
} from '../collab/inviteLink'
import { verifyInviteAllowList, WorkspaceAuthManager } from '../collab/workspaceAuth'
import {
  forgetWorkspace,
  rememberWorkspace,
  workspacesForEmail,
  type StoredWorkspace,
} from '../collab/workspaceStore'
import {
  createSessionFromInvite,
  loadIdToken,
  loadIdentityEmail,
  loadIdentityProvider,
  loadPersistedSession,
  clearIdCredentials,
  saveIdCredentials,
  saveSession,
  type Session,
} from '../session'
import { IdentityLoginButtons, type SignedInIdentity } from './IdentityLoginButtons'

type Props = {
  onJoined: (session: Session) => void
}

type Mode = 'create' | 'join'

const PLACEHOLDER_ALLOW_LIST = { emails: [] as string[], signedAt: 0, signature: '' }

/**
 * Restore the signed-in identity independently of any workspace, so leaving one
 * drops you on the picker still signed in rather than back at sign-in.
 */
function restoreSignedInIdentity(): SignedInIdentity | null {
  const token = loadIdToken()
  const providerId = loadIdentityProvider()
  const email = loadIdentityEmail()
  if (!token || !providerId || !email) return null
  return { email, token, providerId }
}

export function JoinScreen({ onJoined }: Props) {
  const saved = loadPersistedSession()
  const [mode, setMode] = useState<Mode>('create')
  const [workspaceName, setWorkspaceName] = useState(saved?.workspaceName ?? 'My team')
  const [guestEmails, setGuestEmails] = useState('')
  const [invite, setInvite] = useState<WorkspaceInvite | null>(null)
  const hashInvite =
    typeof window !== 'undefined' ? decodeInviteFromHash(window.location.hash) : null
  const activeInvite = invite ?? hashInvite
  const activeMode: Mode = activeInvite ? 'join' : mode
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState<SignedInIdentity | null>(() => restoreSignedInIdentity())
  const [myWorkspaces, setMyWorkspaces] = useState<StoredWorkspace[]>([])
  const authManagerRef = useRef(
    new WorkspaceAuthManager({
      workspaceId: 'pending',
      creatorKeyId: 'P-256:pending:pending',
      allowList: PLACEHOLDER_ALLOW_LIST,
    })
  )

  useEffect(() => {
    if (signedIn) {
      authManagerRef.current.setIdToken(signedIn.token, signedIn.providerId)
    }
    // Only offer workspaces this identity is actually allowed into — signing in
    // as someone else must not present a list that would fail at the handshake.
    setMyWorkspaces(signedIn ? workspacesForEmail(signedIn.email) : [])
  }, [signedIn])

  useEffect(() => {
    const syncInviteFromHash = () => {
      const parsed = decodeInviteFromHash(window.location.hash)
      if (parsed) {
        setInvite(parsed)
        setMode('join')
      }
    }
    syncInviteFromHash()
    window.addEventListener('hashchange', syncInviteFromHash)
    return () => window.removeEventListener('hashchange', syncInviteFromHash)
  }, [])

  const authManagerForInvite = (nextInvite: WorkspaceAccess) => {
    const manager = new WorkspaceAuthManager({
      workspaceId: nextInvite.workspaceId,
      creatorKeyId: nextInvite.creatorKeyId,
      allowList: nextInvite.allowList,
    })
    if (signedIn) {
      manager.setIdToken(signedIn.token, signedIn.providerId)
    }
    authManagerRef.current = manager
    return manager
  }

  const requireSignedIn = (): SignedInIdentity => {
    if (!signedIn) {
      throw new Error('Sign in with one of the providers above to continue')
    }
    return signedIn
  }

  const completeJoin = async (
    nextInvite: WorkspaceAccess,
    identity: SignedInIdentity,
    name?: string
  ) => {
    if (!isEmailAllowed(nextInvite.allowList, identity.email)) {
      throw new Error(`${identity.email} is not on this workspace's invite list`)
    }

    saveIdCredentials(identity.token, identity.providerId, identity.email)
    const session = createSessionFromInvite(
      nextInvite,
      identity.email,
      identity.providerId,
      name ?? identity.name
    )
    saveSession(session)
    // Remember it so the next sign-in offers it without the invite link.
    rememberWorkspace({
      workspaceId: nextInvite.workspaceId,
      workspaceName: nextInvite.workspaceName,
      creatorKeyId: nextInvite.creatorKeyId,
      allowList: nextInvite.allowList,
    })
    history.replaceState(null, '', location.pathname)
    onJoined(session)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const name = workspaceName.trim()
      if (!name) throw new Error('Workspace name is required')

      const guests = guestEmails
        .split(/[,\s]+/)
        .map(email => email.trim())
        .filter(Boolean)

      const identity = requireSignedIn()
      const manager = authManagerRef.current
      manager.setIdToken(identity.token, identity.providerId)

      const nextInvite = await manager.createInvite(name, [identity.email, ...guests])
      setCreatedInviteLink(encodeInviteLink(nextInvite))
      setInvite(nextInvite)
      await completeJoin(nextInvite, identity, identity.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Re-open a workspace this browser already joined, without needing the link again. */
  const handleOpenStored = async (workspace: StoredWorkspace) => {
    setError(null)
    setBusy(true)
    try {
      const identity = requireSignedIn()
      // Re-verify rather than trust localStorage: the stored list is only as
      // good as whatever last wrote it, and this is the same check the invite
      // path runs. Peers verify independently regardless, but failing here
      // gives a comprehensible message instead of a silent handshake denial.
      if (!(await verifyInviteAllowList(workspace))) {
        throw new Error('Stored workspace has an invalid signature — rejoin with the invite link')
      }
      authManagerForInvite(workspace)
      await completeJoin(workspace, identity, identity.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeInvite) {
      setError('Open a valid invite link to join a workspace')
      return
    }

    setError(null)
    setBusy(true)
    try {
      if (!(await verifyInviteAllowList(activeInvite))) {
        throw new Error('Invite link signature is invalid')
      }

      const identity = requireSignedIn()
      authManagerForInvite(activeInvite)
      await completeJoin(activeInvite, identity, identity.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const identitySection = (
    <IdentityLoginButtons
      authManager={authManagerRef.current}
      signedIn={signedIn}
      onSignedIn={setSignedIn}
      onSignOut={() => {
        clearIdCredentials()
        setSignedIn(null)
      }}
      busy={busy}
      onBusyChange={setBusy}
      onError={setError}
    />
  )

  const inviteBanner = activeInvite ? (
    <div
      className="rounded-box border border-primary/30 bg-primary/10 px-4 py-3 text-center"
      data-testid="invite-summary"
    >
      <p className="text-sm text-base-content/70">You've been invited to</p>
      <p className="text-base font-semibold text-base-content">{activeInvite.workspaceName}</p>
    </div>
  ) : null

  // Nothing actionable is rendered until the user has a verified identity:
  // every path from here (create, join, reopen) needs one, and showing forms
  // that cannot be submitted only invites people to fill them in and fail.
  if (!signedIn) {
    return (
      <div className="join-screen flex min-h-full items-center justify-center p-4">
        <div className="join-card w-full max-w-md space-y-5">
          <header className="space-y-2 text-center">
            <div className="join-logo flex items-center justify-center gap-2">
              <span className="logo-icon text-3xl" aria-hidden="true">
                ⚡
              </span>
              <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
            </div>
            <p className="text-sm text-base-content/60">
              Serverless team collaboration — chat, video, and files, peer-to-peer.
            </p>
          </header>

          {/* Shown before sign-in on purpose: tell people what they are being
              asked to sign in *for*. */}
          {inviteBanner}

          <div className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
            <div className="card-body gap-4 p-5">
              <p className="text-center text-sm font-medium text-base-content/80">
                Sign in to continue
              </p>
              {identitySection}
              {error && (
                <div role="alert" className="alert alert-error" data-testid="error-banner">
                  <span className="text-sm">{error}</span>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-xs leading-relaxed text-base-content/50">
            Only invited accounts can connect. Peers verify each other's identity before any data
            flows.
          </p>
          <p
            className="text-center font-mono text-[0.7rem] text-base-content/35"
            data-testid="app-version"
          >
            {appBuildLabel()}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="join-screen flex min-h-full items-center justify-center p-4">
      <div className="join-card w-full max-w-md space-y-5">
        <header className="space-y-2 text-center">
          <div className="join-logo flex items-center justify-center gap-2">
            <span className="logo-icon text-2xl" aria-hidden="true">
              ⚡
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          </div>
        </header>

        {/* Who you are, first — it decides which workspaces appear below. */}
        {identitySection}

        {inviteBanner}

        {myWorkspaces.length > 0 && (
          <section className="space-y-2" data-testid="workspace-picker">
            <h2 className="text-xs font-medium uppercase tracking-wider text-base-content/50">
              Your workspaces
            </h2>
            <ul className="space-y-1.5">
              {myWorkspaces.map(workspace => (
                <li key={workspace.workspaceId} className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    className="flex flex-1 items-center justify-between gap-3 rounded-box border border-base-300 bg-base-200 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-base-300 disabled:opacity-60"
                    data-testid={`open-workspace-${workspace.workspaceName}`}
                    disabled={busy}
                    onClick={() => void handleOpenStored(workspace)}
                  >
                    <span className="truncate text-sm font-medium">{workspace.workspaceName}</span>
                    <span className="shrink-0 text-xs text-base-content/50">
                      {workspace.allowList.emails.length} member
                      {workspace.allowList.emails.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-sm text-base-content/40 hover:text-error"
                    title="Remove from this list (does not affect the workspace)"
                    aria-label={`Forget ${workspace.workspaceName}`}
                    data-testid={`forget-workspace-${workspace.workspaceName}`}
                    onClick={() => {
                      forgetWorkspace(workspace.workspaceId)
                      setMyWorkspaces(workspacesForEmail(signedIn.email))
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
          <div className="card-body gap-4 p-5">
            <div role="tablist" className="tabs tabs-boxed join-tabs bg-base-300/50">
              <button
                type="button"
                role="tab"
                className={`tab flex-1 ${activeMode === 'create' ? 'tab-active' : ''}`}
                onClick={() => setMode('create')}
                data-testid="create-workspace-tab"
              >
                Create workspace
              </button>
              <button
                type="button"
                role="tab"
                className={`tab flex-1 ${activeMode === 'join' ? 'tab-active' : ''}`}
                onClick={() => setMode('join')}
                data-testid="join-workspace-tab"
              >
                Join with invite
              </button>
            </div>

            {activeMode === 'create' ? (
              <form onSubmit={handleCreate} className="join-form space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-base-content/70">
                    Workspace name
                  </span>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="My team"
                    value={workspaceName}
                    onChange={e => setWorkspaceName(e.target.value)}
                    data-testid="workspace-name"
                    autoFocus
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-base-content/70">
                    Invite teammates <span className="text-base-content/40">(optional)</span>
                  </span>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="alice@company.com, bob@company.com"
                    value={guestEmails}
                    onChange={e => setGuestEmails(e.target.value)}
                    data-testid="guest-emails"
                  />
                </label>

                <p className="text-xs leading-relaxed text-base-content/50">
                  You'll get a secret invite link to share. You can add more people later.
                </p>

                <button
                  type="submit"
                  className="btn btn-primary w-full"
                  data-testid="join-submit"
                  disabled={busy}
                >
                  {busy ? 'Working…' : 'Create workspace'}
                </button>

                {createdInviteLink && (
                  <div className="invite-link-box space-y-1.5" data-testid="invite-link-box">
                    <span className="text-xs font-medium text-base-content/70">Invite link</span>
                    <div className="join w-full">
                      <input
                        className="input input-bordered join-item w-full font-mono text-xs"
                        readOnly
                        value={createdInviteLink}
                        data-testid="invite-link"
                        onFocus={e => e.currentTarget.select()}
                      />
                      <button
                        type="button"
                        className="btn btn-primary join-item"
                        data-testid="copy-created-invite"
                        onClick={() => void navigator.clipboard.writeText(createdInviteLink)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={handleJoin} className="join-form space-y-3">
                {!activeInvite && (
                  <p className="text-xs leading-relaxed text-base-content/50">
                    Open an invite link from your workspace creator — it looks like{' '}
                    <code className="rounded bg-base-300 px-1 py-0.5 font-mono">
                      https://…/#invite=…
                    </code>
                  </p>
                )}

                <button
                  type="submit"
                  className="btn btn-primary w-full"
                  data-testid="join-submit"
                  disabled={busy || !activeInvite}
                >
                  {busy ? 'Joining…' : 'Join workspace'}
                </button>
              </form>
            )}

            {error && (
              <div role="alert" className="alert alert-error" data-testid="error-banner">
                <span className="text-sm">{error}</span>
              </div>
            )}
          </div>
        </div>

        <p
          className="text-center font-mono text-[0.7rem] text-base-content/35"
          data-testid="app-version"
        >
          {appBuildLabel()}
        </p>
      </div>
    </div>
  )
}
