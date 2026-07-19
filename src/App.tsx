import { useEffect, useMemo, useState } from 'react'
import { isE2eAuthBypass } from './collab/e2eAuth'
import { DeviceIdentity } from './collab/deviceIdentity'
import { WorkspaceAuthManager } from './collab/workspaceAuth'
import { JoinScreen } from './components/JoinScreen'
import { Workspace } from './components/Workspace'
import { useAppRouting } from './hooks/useAppRouting'
import { useFriends } from './hooks/useFriends'
import { useWorkspaceAuth } from './hooks/useWorkspaceAuth'
import { rememberWorkspace, snapshotWorkspace } from './collab/workspaceStore'
import {
  clearActiveWorkspace,
  hydrateSessionAvatar,
  loadIdToken,
  loadSession,
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

  if (!ready) {
    return null
  }

  if (!session) {
    return (
      <JoinScreen
        pickerTab={pickerTab}
        onPickerTabChange={setPickerTab}
        onJoined={async next => {
          setSession(await hydrateSessionAvatar(next))
          enterWorkspace()
        }}
      />
    )
  }

  return (
    <Workspace
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
      onLeave={() => {
        // Close the workspace, keep the sign-in: the user lands on the picker
        // and can open another workspace without authenticating again.
        clearActiveWorkspace()
        setSession(null)
        leaveToPicker()
      }}
    />
  )
}

export default App
