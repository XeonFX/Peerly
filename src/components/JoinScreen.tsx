import { useEffect, useRef, useState } from 'react'
import { isEmailAllowed } from '../collab/allowList'
import { APP_NAME, appBuildLabel, WORKSPACE_COLOR } from '../config'
import {
  decodeInviteFromHash,
  encodeInviteLink,
  type WorkspaceAccess,
  type WorkspaceInvite,
} from '../collab/inviteLink'
import { verifyInviteAllowList, WorkspaceAuthManager } from '../collab/workspaceAuth'
import { resolveAvatarPreview } from '../collab/avatarService'
import { applyWorkspaceBackup, MAX_BACKUP_BYTES } from '../utils/workspaceBackup'
import {
  forgetWorkspace,
  rememberWorkspace,
  snapshotWorkspace,
  workspacesForEmail,
  type StoredWorkspace,
} from '../collab/workspaceStore'
import {
  createSessionFromInvite,
  loadIdToken,
  loadIdentityEmail,
  loadIdentityUserId,
  loadIdentityProvider,
  loadPersistedSession,
  clearIdCredentials,
  saveIdCredentials,
  saveSession,
  type Session,
} from '../session'
import {
  clearWorkspaceFiles,
  estimateWorkspacesUsage,
  formatUsage,
  type WorkspaceUsage,
} from '../utils/workspaceUsage'
import { Avatar } from './Avatar'
import { IdentityLoginButtons, type SignedInIdentity } from './IdentityLoginButtons'
import peerlyBrand from '../assets/peerly-brand.webp'
import { useBrowserStorage } from '../hooks/useBrowserStorage'
import { BrowserStorageCard } from './BrowserStorageCard'
import { ThemeToggle } from './ThemeToggle'
import { useP2pCapability } from '../hooks/useP2pCapability'
import { P2pCapabilityIndicator } from './P2pCapabilityIndicator'
import { Icon } from './Icon'
import { LegalLinks } from './LegalLinks'
import { useI18n } from '../i18n'

function WorkspaceUsageBadge({ usage }: { usage: WorkspaceUsage | undefined }) {
  const { tr } = useI18n()
  if (!usage) return null
  return (
    <span
      className="shrink-0 font-mono text-[0.65rem] text-base-content/40"
      title={`${formatUsage(usage.messagesBytes)} messages + ${formatUsage(usage.filesBytes)} in ${usage.fileCount} cached file${usage.fileCount === 1 ? '' : 's'}`}
    >
      {formatUsage(usage.totalBytes)} {tr('on device')} · {formatUsage(usage.sharedFilesBytes)} {tr('shared')}
    </span>
  )
}

function WorkspacePickerAvatar({ workspace }: { workspace: StoredWorkspace }) {
  const [preview, setPreview] = useState<string>()
  useEffect(() => {
    let cancelled = false
    void resolveAvatarPreview(workspace.workspaceAvatarId).then(url => {
      if (!cancelled && url) setPreview(url)
    })
    return () => {
      cancelled = true
    }
  }, [workspace.workspaceAvatarId])

  return (
    <Avatar
      name={workspace.workspaceName}
      color={WORKSPACE_COLOR}
      avatar={preview}
      size="md"
    />
  )
}

type Props = {
  pickerTab: 'create' | 'join'
  onPickerTabChange: (tab: 'create' | 'join') => void
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
  return { email, token, providerId, userId: loadIdentityUserId() ?? undefined }
}

export function JoinScreen({ pickerTab, onPickerTabChange, onJoined }: Props) {
  const { tr } = useI18n()
  const browserStorage = useBrowserStorage()
  const { capability: p2pCapability } = useP2pCapability()
  const saved = loadPersistedSession()
  const [workspaceName, setWorkspaceName] = useState(saved?.workspaceName ?? tr('My team'))
  const [guestEmails, setGuestEmails] = useState('')
  const [invite, setInvite] = useState<WorkspaceInvite | null>(null)
  const hashInvite =
    typeof window !== 'undefined' ? decodeInviteFromHash(window.location.hash) : null
  const activeInvite = invite ?? hashInvite
  const activeMode: Mode = activeInvite ? 'join' : pickerTab
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState<SignedInIdentity | null>(() => restoreSignedInIdentity())
  const [myWorkspaces, setMyWorkspaces] = useState<StoredWorkspace[]>([])
  const [usageRefresh, setUsageRefresh] = useState(0)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportBackup = async (file: File) => {
    setImportNotice(null)
    setError(null)
    try {
      if (file.size > MAX_BACKUP_BYTES) {
        throw new Error(tr('Backup is larger than the {size} import limit', { size: formatUsage(MAX_BACKUP_BYTES) }))
      }
      const parsed: unknown = JSON.parse(await file.text())
      const result = await applyWorkspaceBackup(parsed, signedIn?.email)
      if (signedIn) setMyWorkspaces(workspacesForEmail(signedIn.email))
      setUsageRefresh(token => token + 1)
      setImportNotice(tr(
        result.importedMessages === 1
          ? 'Restored "{workspace}" — {count} message imported.'
          : 'Restored "{workspace}" — {count} messages imported.',
        { workspace: result.workspaceName, count: result.importedMessages }
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const [workspaceUsages, setWorkspaceUsages] = useState<Map<string, WorkspaceUsage>>(new Map())

  // One pass for every badge: per-badge estimation re-parsed all histories
  // once per workspace (O(n^2) on the picker).
  useEffect(() => {
    if (myWorkspaces.length === 0) return
    let cancelled = false
    void estimateWorkspacesUsage(myWorkspaces.map(workspace => workspace.workspaceId)).then(
      usages => {
        if (!cancelled) setWorkspaceUsages(usages)
      }
    )
    return () => {
      cancelled = true
    }
  }, [myWorkspaces, usageRefresh])
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
        onPickerTabChange('join')
      }
    }
    syncInviteFromHash()
    window.addEventListener('hashchange', syncInviteFromHash)
    return () => window.removeEventListener('hashchange', syncInviteFromHash)
  }, [onPickerTabChange])

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
      throw new Error(tr('Sign in with one of the providers above to continue'))
    }
    return signedIn
  }

  const completeJoin = async (
    nextInvite: WorkspaceAccess,
    identity: SignedInIdentity,
    name?: string,
    workspaceAvatarId?: string
  ) => {
    if (!isEmailAllowed(nextInvite.allowList, identity.email)) {
      throw new Error(tr('{email} is not on this workspace\'s invite list', { email: identity.email }))
    }

    saveIdCredentials(identity.token, identity.providerId, identity.email, identity.userId)
    const session = createSessionFromInvite(
      { ...nextInvite, workspaceAvatarId },
      identity.email,
      identity.providerId,
      name ?? identity.name,
      identity.userId
    )
    saveSession(session)
    // Remember it so the next sign-in offers it without the invite link.
    rememberWorkspace(
      snapshotWorkspace({
        workspaceId: nextInvite.workspaceId,
        workspaceName: nextInvite.workspaceName,
        creatorKeyId: nextInvite.creatorKeyId,
        allowList: nextInvite.allowList,
        workspaceAvatarId,
      })
    )
    onJoined(session)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const name = workspaceName.trim()
      if (!name) throw new Error(tr('Workspace name is required'))

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
        throw new Error(tr('Stored workspace has an invalid signature — rejoin with the invite link'))
      }
      authManagerForInvite(workspace)
      await completeJoin(workspace, identity, identity.name, workspace.workspaceAvatarId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeInvite) {
      setError(tr('Open a valid invite link to join a workspace'))
      return
    }

    setError(null)
    setBusy(true)
    try {
      if (!(await verifyInviteAllowList(activeInvite))) {
        throw new Error(tr('Invite link signature is invalid'))
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
      <p className="text-sm text-base-content/70">{tr("You've been invited to")}</p>
      <p className="text-base font-semibold text-base-content">{activeInvite.workspaceName}</p>
    </div>
  ) : null

  // Nothing actionable is rendered until the user has a verified identity:
  // every path from here (create, join, reopen) needs one, and showing forms
  // that cannot be submitted only invites people to fill them in and fail.
  if (!signedIn) {
    return (
      <div className="join-screen flex min-h-full items-center justify-center p-4 sm:p-6">
        <div className="fixed right-4 top-4 z-20"><ThemeToggle compact /></div>
        <div className="join-auth-layout w-full max-w-5xl overflow-hidden rounded-[2rem] border border-base-300/70 bg-base-100/80 shadow-2xl shadow-violet-950/10 backdrop-blur-xl">
          <section className="brand-showcase hidden lg:flex">
            <img src={peerlyBrand} alt={tr('Serverless team collaboration — chat, video, and files, peer-to-peer.')} className="brand-showcase-image" />
            <div className="brand-showcase-copy">
              <span className="brand-kicker">{tr('Private by design')}</span>
              <h2>{tr('Your team space, directly between your devices.')}</h2>
              <p>{tr('No message or file server in the middle. Invite-only workspaces connect through verified identities.')}</p>
            </div>
          </section>

          <div className="join-card w-full space-y-5 p-5 sm:p-8 lg:p-10">
          <header className="space-y-2 text-center">
            <div className="join-logo flex items-center justify-center gap-2">
              <span className="brand-mark" aria-hidden="true"><img src={peerlyBrand} alt="" /></span>
              <h1 className="brand-wordmark text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
            </div>
            <p className="text-sm text-base-content/60">
              {tr('Serverless team collaboration — chat, video, and files, peer-to-peer.')}
            </p>
          </header>

          {/* Shown before sign-in on purpose: tell people what they are being
              asked to sign in *for*. */}
          {inviteBanner}

          <div className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
            <div className="card-body gap-4 p-5">
              <p className="text-center text-sm font-medium text-base-content/80">
                {tr('Sign in to continue')}
              </p>
              {identitySection}
              <p className="text-center text-xs text-base-content/50">
                {tr('By signing in you agree to our')}{' '}
                <a href="/terms" className="link link-primary">
                  {tr('Terms')}
                </a>{' '}
                {tr('and')}{' '}
                <a href="/privacy" className="link link-primary">
                  {tr('Privacy Policy')}
                </a>
                .
              </p>
              {error && (
                <div role="alert" className="alert alert-error" data-testid="error-banner">
                  <span className="text-sm">{error}</span>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-xs leading-relaxed text-base-content/50">
            {tr("Only invited accounts can connect. Peers verify each other's identity before any data flows. Sign in with the account you were invited with — a different provider or email counts as a different person.")}
          </p>
          <P2pCapabilityIndicator capability={p2pCapability} rtcPeerCount={0} compact />
          <p
            className="text-center font-mono text-[0.7rem] text-base-content/35"
            data-testid="app-version"
          >
            {appBuildLabel()}
          </p>
          <LegalLinks />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="join-screen flex min-h-full items-center justify-center p-4">
      <div className="fixed right-4 top-4 z-20"><ThemeToggle compact /></div>
      <div className="join-card w-full max-w-2xl space-y-5">
        <header className="space-y-2 text-center">
          <div className="join-logo flex items-center justify-center gap-2">
            <span className="brand-mark brand-mark-sm" aria-hidden="true"><img src={peerlyBrand} alt="" /></span>
            <h1 className="brand-wordmark text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          </div>
        </header>

        {/* Who you are, first — it decides which workspaces appear below. */}
        {identitySection}

        <BrowserStorageCard
          estimate={browserStorage.estimate}
          pressure={browserStorage.pressure}
          onRefresh={() => void browserStorage.refresh(true)}
          onRequestPersistence={browserStorage.requestPersistence}
          requestingPersistence={browserStorage.requestingPersistence}
        />

        <P2pCapabilityIndicator capability={p2pCapability} rtcPeerCount={0} compact />

        {inviteBanner}

        <section className="space-y-2" data-testid="workspace-picker">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-base-content/50">
              {tr('Your workspaces')}
            </h2>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              data-testid="import-backup"
              onClick={() => importInputRef.current?.click()}
            >
              {tr('Import backup')}
            </button>
          </div>
          <input
            id="workspace-backup-import"
            name="workspaceBackup"
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="import-backup-input"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void handleImportBackup(file)
              e.target.value = ''
            }}
          />
          {importNotice && (
            <p className="text-xs text-success" data-testid="import-notice">
              {importNotice}
            </p>
          )}
          {myWorkspaces.length === 0 && (
            <p className="rounded-box border border-dashed border-base-300 px-3 py-2.5 text-sm text-base-content/50">
              {tr('No workspaces remembered in this browser. Import a backup or create a new one.')}
            </p>
          )}
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
                    <span className="flex min-w-0 items-center gap-2.5">
                      <WorkspacePickerAvatar workspace={workspace} />
                      <span className="truncate text-sm font-medium">{workspace.workspaceName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <WorkspaceUsageBadge usage={workspaceUsages.get(workspace.workspaceId)} />
                      <span className="text-xs text-base-content/50">
                        {workspace.allowList.emails.length} {tr(workspace.allowList.emails.length === 1 ? 'member' : 'members')}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-sm text-base-content/40 hover:text-warning"
                    title={tr('Free local space by removing cached full-size files. Messages and previews stay available.')}
                    aria-label={tr('Free local space for {workspace}', { workspace: workspace.workspaceName })}
                    data-testid={`clear-workspace-${workspace.workspaceName}`}
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          tr('Remove cached full-size files for “{workspace}”? Messages and previews stay, and originals can be fetched again while a peer has them.', { workspace: workspace.workspaceName })
                        )
                      ) {
                        return
                      }
                      void clearWorkspaceFiles(workspace.workspaceId).then(() =>
                        setUsageRefresh(token => token + 1)
                      )
                    }}
                  >
                    <Icon name="broom" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-sm text-base-content/40 hover:text-error"
                    title={tr('Remove from this list (does not affect the workspace)')}
                    aria-label={tr('Forget {workspace}', { workspace: workspace.workspaceName })}
                    data-testid={`forget-workspace-${workspace.workspaceName}`}
                    onClick={() => {
                      forgetWorkspace(workspace.workspaceId)
                      setMyWorkspaces(workspacesForEmail(signedIn.email))
                    }}
                  >
                    <Icon name="x" />
                  </button>
                </li>
              ))}
          </ul>
        </section>

        <div className="card border border-base-300/80 bg-base-200/70 shadow-xl shadow-black/20 backdrop-blur-xl">
          <div className="card-body gap-4 p-5">
            <div role="tablist" className="tabs tabs-boxed join-tabs bg-base-300/50">
              <button
                type="button"
                role="tab"
                className={`tab flex-1 ${activeMode === 'create' ? 'tab-active' : ''}`}
                onClick={() => onPickerTabChange('create')}
                data-testid="create-workspace-tab"
              >
                {tr('Create workspace')}
              </button>
              <button
                type="button"
                role="tab"
                className={`tab flex-1 ${activeMode === 'join' ? 'tab-active' : ''}`}
                onClick={() => onPickerTabChange('join')}
                data-testid="join-workspace-tab"
              >
                {tr('Join with invite')}
              </button>
            </div>

            {activeMode === 'create' ? (
              <form onSubmit={handleCreate} className="join-form space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-base-content/70">
                    {tr('Workspace name')}
                  </span>
                  <input
                    id="create-workspace-name"
                    name="workspaceName"
                    type="text"
                    className="input input-bordered w-full"
                    placeholder={tr('My team')}
                    value={workspaceName}
                    onChange={e => setWorkspaceName(e.target.value)}
                    data-testid="workspace-name"
                    autoFocus
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-base-content/70">
                    {tr('Invite teammates')} <span className="text-base-content/40">({tr('optional')})</span>
                  </span>
                  <input
                    id="create-workspace-invitees"
                    name="guestEmails"
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="alice@company.com, bob@company.com"
                    value={guestEmails}
                    onChange={e => setGuestEmails(e.target.value)}
                    data-testid="guest-emails"
                  />
                </label>

                <p className="text-xs leading-relaxed text-base-content/50">
                  {tr("You'll get a secret invite link to share. You can add more people later.")}
                </p>

                <button
                  type="submit"
                  className="btn btn-primary w-full"
                  data-testid="join-submit"
                  disabled={busy}
                >
                  {busy ? `${tr('Working')}…` : tr('Create workspace')}
                </button>

                {createdInviteLink && (
                  <div className="invite-link-box space-y-1.5" data-testid="invite-link-box">
                    <span className="text-xs font-medium text-base-content/70">{tr('Invite link')}</span>
                    <div className="join w-full">
                      <input
                        id="created-workspace-invite-link"
                        name="createdWorkspaceInviteLink"
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
                        {tr('Copy')}
                      </button>
                    </div>
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={handleJoin} className="join-form space-y-3">
                {!activeInvite && (
                  <p className="text-xs leading-relaxed text-base-content/50">
                    {tr('Open an invite link from your workspace creator — it looks like')}{' '}
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
                  {busy ? `${tr('Joining')}…` : tr('Join workspace')}
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
        <LegalLinks />
      </div>
    </div>
  )
}
