import { useEffect, useRef, useState } from 'react'
import { isEmailAllowed } from '../collab/allowList'
import { isE2eAuthBypass } from '../collab/e2eAuth'
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

  const identityReady = isE2eAuthBypass() || signedIn !== null

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

  return (
    <div className="join-screen">
      <div className="join-card">
        <div className="join-logo">
          <span className="logo-icon">⚡</span>
          <h1>{APP_NAME}</h1>
        </div>
        <p className="join-subtitle">
          Serverless team collaboration — chat, video, and files over peer-to-peer WebRTC.
        </p>

        <div className="join-tabs">
          <button
            type="button"
            className={activeMode === 'create' ? 'active' : ''}
            onClick={() => setMode('create')}
            data-testid="create-workspace-tab"
          >
            Create workspace
          </button>
          <button
            type="button"
            className={activeMode === 'join' ? 'active' : ''}
            onClick={() => setMode('join')}
            data-testid="join-workspace-tab"
          >
            Join with invite
          </button>
        </div>

        {identitySection}

        {signedIn && myWorkspaces.length > 0 && (
          <div className="workspace-picker" data-testid="workspace-picker">
            <span className="workspace-picker-title">Your workspaces</span>
            <ul className="workspace-list">
              {myWorkspaces.map(workspace => (
                <li key={workspace.workspaceId}>
                  <button
                    type="button"
                    className="workspace-item"
                    data-testid={`open-workspace-${workspace.workspaceName}`}
                    disabled={busy}
                    onClick={() => void handleOpenStored(workspace)}
                  >
                    <span className="workspace-item-name">{workspace.workspaceName}</span>
                    <span className="workspace-item-meta">
                      {workspace.allowList.emails.length} member
                      {workspace.allowList.emails.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn-forget-workspace"
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
          </div>
        )}

        {activeMode === 'create' ? (
          <form onSubmit={handleCreate} className="join-form">
            <label>
              <span>Workspace name</span>
              <input
                type="text"
                placeholder="My team"
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                data-testid="workspace-name"
                autoFocus
              />
            </label>

            <label>
              <span>Invite teammates (emails, optional)</span>
              <input
                type="text"
                placeholder="alice@company.com, bob@company.com"
                value={guestEmails}
                onChange={e => setGuestEmails(e.target.value)}
                data-testid="guest-emails"
              />
            </label>

            {isE2eAuthBypass() && !signedIn && (
              <label>
                <span>Your email (test mode)</span>
                <input
                  type="email"
                  placeholder="alice@e2e.test"
                  data-testid="e2e-email"
                  defaultValue="alice@e2e.test"
                />
              </label>
            )}

            <p className="password-hint">
              After signing in, a secret invite link is generated automatically — share it with
              teammates you listed.
            </p>

            <button
              type="submit"
              className="btn-primary"
              data-testid="join-submit"
              disabled={busy || !identityReady}
            >
              {busy ? 'Working…' : 'Create workspace'}
            </button>

            {createdInviteLink && (
              <div className="invite-link-box" data-testid="invite-link">
                <span>Invite link</span>
                <input readOnly value={createdInviteLink} onFocus={e => e.target.select()} />
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={handleJoin} className="join-form">
            {activeInvite ? (
              <>
                <p className="invite-summary" data-testid="invite-summary">
                  Joining <strong>{activeInvite.workspaceName}</strong>
                </p>
                <p className="password-hint">
                  Sign in with an account on the workspace invite list, then join.
                </p>
              </>
            ) : (
              <p className="password-hint">
                Open an invite link from your workspace creator (it looks like{' '}
                <code>https://…/#invite=…</code>).
              </p>
            )}

            {isE2eAuthBypass() && !signedIn && (
              <label>
                <span>Your email (test mode)</span>
                <input
                  type="email"
                  placeholder="bob@e2e.test"
                  data-testid="e2e-email"
                  defaultValue="bob@e2e.test"
                />
              </label>
            )}

            <button
              type="submit"
              className="btn-primary"
              data-testid="join-submit"
              disabled={busy || !activeInvite || !identityReady}
            >
              {busy ? 'Joining…' : 'Join workspace'}
            </button>
          </form>
        )}

        {error && (
          <p className="error-banner" data-testid="error-banner">
            {error}
          </p>
        )}

        <p className="join-hint">
          Workspace access is enforced cryptographically: only invited accounts can connect, and
          peers verify each other's identity before any data flows.
        </p>

        <p className="join-version" data-testid="app-version">
          {appBuildLabel()}
        </p>
      </div>
    </div>
  )
}