import { useEffect, useRef, useState } from 'react'
import { isEmailAllowed } from '../collab/allowList'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import {
  decodeInviteFromHash,
  encodeInviteLink,
  type WorkspaceInvite,
} from '../collab/inviteLink'
import { verifyInviteAllowList, WorkspaceAuthManager } from '../collab/workspaceAuth'
import {
  createSessionFromInvite,
  loadIdToken,
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

function restoreSignedInIdentity(): SignedInIdentity | null {
  const token = loadIdToken()
  const providerId = loadIdentityProvider()
  const persisted = loadPersistedSession()
  if (!token || !providerId || !persisted?.identityEmail) return null
  return {
    email: persisted.identityEmail,
    token,
    providerId,
  }
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

  const authManagerForInvite = (nextInvite: WorkspaceInvite) => {
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
    nextInvite: WorkspaceInvite,
    identity: SignedInIdentity,
    name?: string
  ) => {
    if (!isEmailAllowed(nextInvite.allowList, identity.email)) {
      throw new Error(`${identity.email} is not on this workspace's invite list`)
    }

    saveIdCredentials(identity.token, identity.providerId)
    const session = createSessionFromInvite(
      nextInvite,
      identity.email,
      identity.providerId,
      name ?? identity.name
    )
    saveSession(session)
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
          <h1>Flux</h1>
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
      </div>
    </div>
  )
}