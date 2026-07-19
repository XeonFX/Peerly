import { useEffect, useMemo, useState } from 'react'
import { isE2eAuthBypass } from './collab/e2eAuth'
import { DeviceIdentity } from './collab/deviceIdentity'
import { WorkspaceAuthManager } from './collab/workspaceAuth'
import { ConsentBanner } from './components/ConsentBanner'
import { JoinScreen } from './components/JoinScreen'
import { LegalPage } from './legal/LegalPage'
import { Workspace } from './components/Workspace'
import { acceptCurrentLegal, hasAcceptedCurrentLegal } from './consent'
import { defaultWorkspaceRoute } from './routing'
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
  const { route, navigate, pickerTab, workspaceRoute, enterWorkspace, leaveToPicker, setPickerTab, setWorkspaceRoute } =
    useAppRouting(Boolean(session), ready)
  const [legalAccepted, setLegalAccepted] = useState(() => hasAcceptedCurrentLegal())
  const acceptLegal = () => {
    acceptCurrentLegal()
    setLegalAccepted(true)
  }

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

  // Public legal pages render regardless of session/hydration state.
  if (route.screen === 'legal') {
    return (
      <LegalPage
        doc={route.doc}
        onBack={() => navigate(session ? defaultWorkspaceRoute() : { screen: 'picker', tab: 'create' })}
      />
    )
  }

  if (!ready) {
    return null
  }

  const consentBanner = legalAccepted ? null : <ConsentBanner onAccept={acceptLegal} />

  if (!session) {
    return (
      <>
        <JoinScreen
          pickerTab={pickerTab}
          onPickerTabChange={setPickerTab}
          onJoined={async next => {
            setSession(await hydrateSessionAvatar(next))
            enterWorkspace()
          }}
        />
        {consentBanner}
      </>
    )
  }

  return (
    <>
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
    {consentBanner}
    </>
  )
}

export default App
