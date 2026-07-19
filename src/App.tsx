import { useEffect, useMemo, useState } from 'react'
import { isE2eAuthBypass } from './collab/e2eAuth'
import { DeviceIdentity } from './collab/deviceIdentity'
import { WorkspaceAuthManager } from './collab/workspaceAuth'
import { JoinScreen } from './components/JoinScreen'
import { Workspace } from './components/Workspace'
import { WorkspaceRail } from './components/WorkspaceRail'
import { useAppRouting } from './hooks/useAppRouting'
import { useFriends } from './hooks/useFriends'
import { useWorkspaceAuth } from './hooks/useWorkspaceAuth'
import { enterStoredWorkspace } from './collab/enterWorkspace'
import {
  rememberWorkspace,
  snapshotWorkspace,
  workspacesForEmail,
  type StoredWorkspace,
} from './collab/workspaceStore'
import {
  clearActiveWorkspace,
  hydrateSessionAvatar,
  loadIdentityEmail,
  loadIdToken,
  loadSession,
  loadSignedInIdentity,
  migrateLegacySession,
  saveIdCredentials,
  saveSession,
  type Session,
} from './session'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const { pickerTab, workspaceRoute, enterWorkspace, leaveToPicker, setPickerTab, setWorkspaceRoute } =
    useAppRouting(Boolean(session), ready)

  const deviceIdentity = useMemo(() => new DeviceIdentity(), [])
  const friendsApi = useFriends(deviceIdentity, session?.identityUserId)

  const { manager, peerHandshake, resolvePeerUserId, resolvePeerContact, signMessage, signReaction, getBoundUserId } =
    useWorkspaceAuth(session, allowList => {
      setSession(prev => {
        if (!prev) return prev
        const next = { ...prev, allowList }
        saveSession(next)
        // A peer showed us a newer creator-signed list (someone was invited).
        // Persist it so the picker and future invite links carry it too.
        rememberWorkspace(snapshotWorkspace(next))
        return next
      })
    })

  useEffect(() => {
    void (async () => {
      await migrateLegacySession()
      // A session without a live token is still a session: the user lands back
      // in their workspace and the ReauthBanner ('expired' phase) handles
      // getting a fresh token for new handshakes. E2E keeps its silent mint.
      const loaded = loadSession()
      if (loaded && !loadIdToken() && isE2eAuthBypass()) {
        const manager = new WorkspaceAuthManager({
          workspaceId: loaded.workspaceId,
          creatorKeyId: loaded.creatorKeyId,
          allowList: loaded.allowList,
        })
        await manager.signInWithE2eEmail(loaded.identityEmail)
        const token = manager.getIdToken()
        if (token) {
          saveIdCredentials(token, loaded.identityProvider, loaded.identityEmail)
          saveSession(loaded)
        }
      }
      if (loaded) {
        setSession(await hydrateSessionAvatar(loaded))
      }
      setReady(true)
    })()
  }, [])

  const updateSession = (patch: Partial<Session>) => {
    setSession(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      saveSession(next)
      return next
    })
  }

  // Rail data: the signed-in email drives which workspaces to offer, and it
  // survives leaving a workspace (identity outlives the active session), so the
  // rail stays populated on the home view too. loadIdentityEmail() reads even
  // when the token has expired — listing is a UX filter, not authorization.
  const identityEmail = session?.identityEmail ?? loadIdentityEmail() ?? undefined
  const railWorkspaces = useMemo(
    () => (identityEmail ? workspacesForEmail(identityEmail) : []),
    [identityEmail, session?.workspaceId]
  )

  /** Close the active workspace, stay signed in, land on the home/DM view. */
  const goHome = () => {
    clearActiveWorkspace()
    setSession(null)
    leaveToPicker()
  }

  /** Switch to another remembered workspace in place — no sign-out round trip. */
  const switchWorkspace = async (workspace: StoredWorkspace) => {
    if (workspace.workspaceId === session?.workspaceId) return
    const identity = loadSignedInIdentity()
    // Token expired (ReauthBanner territory) — send them home to re-authenticate
    // rather than persist a workspace we cannot hand a live token.
    if (!identity) {
      goHome()
      return
    }
    try {
      const next = await enterStoredWorkspace(workspace, identity)
      setSession(await hydrateSessionAvatar(next))
      enterWorkspace()
    } catch {
      // Invalid signature / no longer on the allow-list — bounce home to re-pick.
      goHome()
    }
  }

  const createWorkspace = () => {
    goHome()
    setPickerTab('create')
  }

  if (!ready) {
    return null
  }

  const content = session ? (
    <Workspace
      // Remount on workspace switch so the collab room tears down and rejoins
      // cleanly for the new workspace instead of mutating a live one.
      key={session.workspaceId}
      session={session}
      workspaceRoute={workspaceRoute}
      onWorkspaceRouteChange={setWorkspaceRoute}
      peerHandshake={peerHandshake}
      resolvePeerUserId={resolvePeerUserId}
      resolvePeerContact={resolvePeerContact}
      signMessage={signMessage}
      signReaction={signReaction}
      getBoundUserId={getBoundUserId}
      authManager={manager}
      onSessionChange={updateSession}
      friends={friendsApi.friends}
      isFriend={friendsApi.has}
      onAddFriend={friendsApi.add}
      onRemoveFriend={friendsApi.remove}
      inviteableFriends={emails => friendsApi.inviteable(emails)}
      onLeave={goHome}
    />
  ) : (
    <JoinScreen
      pickerTab={pickerTab}
      onPickerTabChange={setPickerTab}
      onJoined={async next => {
        setSession(await hydrateSessionAvatar(next))
        enterWorkspace()
      }}
    />
  )

  // Before sign-in there are no workspaces and nowhere to switch — show the bare
  // join screen without the rail. Once an identity exists, the rail is persistent.
  if (!identityEmail) return content

  return (
    <div className="flex h-dvh min-h-0">
      <WorkspaceRail
        workspaces={railWorkspaces}
        activeWorkspaceId={session?.workspaceId}
        onHome={!session}
        onSelectWorkspace={switchWorkspace}
        onHomeSelect={goHome}
        onCreateWorkspace={createWorkspace}
      />
      <div className="min-w-0 flex-1 overflow-hidden">{content}</div>
    </div>
  )
}

export default App
