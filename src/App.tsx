import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { base64UrlToBytes, configureRuntimeAuthCredentialProvider } from '@peerly/core'
import { deriveUserId } from './collab/userId'
import { isE2eAuthBypass } from './collab/e2eAuth'
import { DeviceIdentity } from './collab/deviceIdentity'
import { loadStoredProfile } from './collab/profileStore'
import { WorkspaceAuthManager } from './collab/workspaceAuth'
import { ConsentBanner } from './components/ConsentBanner'
import { HomeView } from './components/HomeView'
import { JoinScreen } from './components/JoinScreen'
import type { DmRingPayload } from './collab/dmRing'
import { WorkspaceRail } from './components/WorkspaceRail'
import { acceptCurrentLegal, hasAcceptedCurrentLegal } from './consent'
import { defaultWorkspaceRoute } from './routing'
import { useAppRouting } from './hooks/useAppRouting'
import { useApprovedDeviceSync } from './hooks/useApprovedDeviceSync'
import { useFriends } from './hooks/useFriends'
import { usePresenceLobby } from './hooks/usePresenceLobby'
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
  clearIdCredentials,
  hydrateSessionAvatar,
  loadIdentityEmail,
  loadIdentityProvider,
  loadIdentityUserId,
  loadIdToken,
  loadSession,
  loadSignedInIdentity,
  migrateLegacySession,
  saveIdCredentials,
  saveSession,
  type Session,
} from './session'
import type { IncomingFriendInvite } from './collab/friendInviteStore'
import { loadDmNotificationsEnabled } from './collab/notificationPreference'

const MyDevicesPage = lazy(() => import('./components/MyDevicesPage').then(module => ({ default: module.MyDevicesPage })))
const SyncActivityPage = lazy(() => import('./components/SyncActivityPage').then(module => ({ default: module.SyncActivityPage })))
const LegalPage = lazy(() => import('./legal/LegalPage').then(module => ({ default: module.LegalPage })))
const Workspace = lazy(() => import('./components/Workspace').then(module => ({ default: module.Workspace })))
const AccountPreferencesPage = lazy(() => import('./components/AccountPreferencesPage').then(module => ({ default: module.AccountPreferencesPage })))

const deviceIdentity = new DeviceIdentity()

configureRuntimeAuthCredentialProvider(() => {
  const token = loadIdToken()
  const providerId = loadIdentityProvider()
  return token && providerId ? { token, providerId, signer: deviceIdentity } : null
})

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [, setIdentityVersion] = useState(0)
  const signedIn = Boolean(loadSignedInIdentity())
  const { route, navigate, pickerTab, workspaceRoute, enterWorkspace, leaveToPicker, setPickerTab, setWorkspaceRoute } =
    useAppRouting(Boolean(session), signedIn, ready)
  const [legalAccepted, setLegalAccepted] = useState(() => hasAcceptedCurrentLegal())
  const acceptLegal = () => {
    acceptCurrentLegal()
    setLegalAccepted(true)
  }

  // Friends outlive the open workspace — use durable identity userId on home too.
  const ownerUserId = session?.identityUserId ?? loadIdentityUserId() ?? undefined
  const friendsApi = useFriends(deviceIdentity, ownerUserId)
  const reloadFriends = friendsApi.reload
  const deviceSyncVersion = useApprovedDeviceSync(deviceIdentity, ownerUserId)
  useEffect(() => {
    reloadFriends()
  }, [deviceSyncVersion, reloadFriends])

  const lobbyProfile = useMemo(() => {
    const email = session?.identityEmail ?? loadIdentityEmail()
    const userId = session?.identityUserId ?? loadIdentityUserId()
    if (!email || !userId) return null
    const stored = loadStoredProfile()
    const name =
      session?.userName ??
      stored.userName ??
      email.split('@')[0] ??
      userId.slice(0, 12)
    return { userId, name, email }
  }, [session?.identityEmail, session?.identityUserId, session?.userName])

  const [pendingDmRing, setPendingDmRing] = useState<DmRingPayload | null>(null)
  const [friendInviteNotice, setFriendInviteNotice] = useState<IncomingFriendInvite | null>(null)

  const notifyFriendInvite = (invite: IncomingFriendInvite) => {
    setFriendInviteNotice(invite)
    if (
      document.visibilityState !== 'visible' &&
      loadDmNotificationsEnabled() &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      const notification = new Notification('New Peerly friend request', {
        body: `${invite.fromName} sent you a friend request.`,
        icon: '/icon-192.png',
        tag: `peerly-friend-${invite.inviteId}`,
      })
      notification.onclick = () => {
        window.focus()
        navigate({ screen: 'home' })
        notification.close()
      }
    }
  }

  const presence = usePresenceLobby({
    identity: lobbyProfile ? deviceIdentity : null,
    profile: lobbyProfile,
    attestation: (() => {
      const idToken = loadIdToken()
      const providerId = loadIdentityProvider()
      return idToken && providerId ? { idToken, providerId } : null
    })(),
    onFriendsChanged: friendsApi.reload,
    onDmRing: ring => setPendingDmRing(ring),
    onFriendInvite: notifyFriendInvite,
  })

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
          saveIdCredentials(token, loaded.identityProvider, loaded.identityEmail, loaded.identityUserId)
          saveSession(loaded)
        }
      }
      // Older sessions predate durable identity metadata. Backfill the user id
      // while the verified workspace session and live token are both present,
      // so leaving the workspace can still render the Home/DM experience.
      const liveToken = loadIdToken()
      if (loaded?.identityUserId && liveToken && !loadIdentityUserId()) {
        saveIdCredentials(liveToken, loaded.identityProvider, loaded.identityEmail, loaded.identityUserId)
      }
      // A signed-in user with no workspace has no stored session to backfill
      // from, so if the opaque user id is still missing (e.g. localStorage was
      // cleared while a token lingered in sessionStorage) derive it from the
      // live token's already-verified claims. Without it lobbyProfile stays
      // null and Home wrongly falls through to the create-workspace screen.
      const provider = loadIdentityProvider()
      const email = loadIdentityEmail()
      if (liveToken && provider && email && !loadIdentityUserId()) {
        try {
          const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(liveToken.split('.')[1] ?? '')))
          if (typeof claims.iss === 'string' && typeof claims.sub === 'string') {
            saveIdCredentials(liveToken, provider, email, await deriveUserId(claims.iss, claims.sub))
          }
        } catch {
          // Malformed token — leave the user id unset; re-auth restores it.
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
  // Reads localStorage each render (cheap: a small JSON parse + filter), so it
  // reflects joins/switches immediately without a reactive store.
  const railWorkspaces = identityEmail ? workspacesForEmail(identityEmail) : []

  /** Close the active workspace, stay signed in, land on the home/DM view. */
  const goHome = () => {
    clearActiveWorkspace()
    setSession(null)
    leaveToPicker()
  }

  /** Switch to another remembered workspace in place — no sign-out round trip. */
  const switchWorkspace = async (workspace: StoredWorkspace) => {
    if (workspace.workspaceId === session?.workspaceId) {
      enterWorkspace()
      return
    }
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
    clearActiveWorkspace()
    setSession(null)
    navigate({ screen: 'picker', tab: 'create' })
  }

  const signOut = () => {
    clearActiveWorkspace()
    clearIdCredentials()
    setSession(null)
    setIdentityVersion(version => version + 1)
    navigate({ screen: 'login' }, { replace: true })
  }

  // Public legal pages render regardless of session/hydration state.
  if (route.screen === 'legal') {
    return (
      <LegalPage
        doc={route.doc}
        onBack={() => navigate(session ? defaultWorkspaceRoute() : signedIn ? { screen: 'home' } : { screen: 'login' })}
      />
    )
  }

  if (!ready) {
    return null
  }

  const consentBanner = legalAccepted ? null : <ConsentBanner onAccept={acceptLegal} />

  const homeSection = route.screen === 'devices'
    ? 'devices'
    : route.screen === 'account'
      ? 'account'
      : route.screen === 'storage'
        ? 'storage'
        : 'friends'

  const content = route.screen === 'sync' ? (
    <SyncActivityPage />
  ) : session && route.screen !== 'home' && route.screen !== 'devices' && route.screen !== 'account' && route.screen !== 'storage' ? (
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
    />
  ) : lobbyProfile && (route.screen === 'home' || route.screen === 'devices' || route.screen === 'account' || route.screen === 'storage') ? (
    <HomeView
      section={homeSection}
      onSectionChange={section => {
        if (section === 'friends') navigate({ screen: 'home' })
        else if (section === 'storage') navigate({ screen: 'storage' })
        else if (section === 'devices') navigate({ screen: 'devices' })
        else navigate({ screen: 'account' })
      }}
      devicesPanel={
        <MyDevicesPage
          identity={deviceIdentity}
          userId={lobbyProfile.userId}
          initialSecret={route.screen === 'devices' ? route.pairSecret : undefined}
        />
      }
      accountPanel={<AccountPreferencesPage email={identityEmail ?? ''} onSignOut={signOut} />}
      profile={lobbyProfile}
      identity={deviceIdentity}
      friends={friendsApi.friends}
      outgoing={presence.outgoing}
      incoming={presence.incoming}
      onlineCount={presence.onlineCount}
      isUserOnline={presence.isUserOnline}
      ringDm={presence.ringDm}
      onInvite={presence.inviteByEmail}
      onAccept={presence.acceptInvite}
      onDecline={presence.declineInvite}
      onCancelOutgoing={presence.cancelOutgoing}
      onRemoveFriend={friendsApi.remove}
      pendingRing={pendingDmRing}
      onConsumeRing={() => setPendingDmRing(null)}
    />
  ) : (
    <JoinScreen
      view={
        route.screen === 'login'
            ? 'login'
            : route.screen === 'picker'
              ? route.tab
              : 'login'
      }
      pickerTab={pickerTab}
      onPickerTabChange={setPickerTab}
      onJoined={async next => {
        setSession(await hydrateSessionAvatar(next))
        if (route.screen !== 'devices') enterWorkspace()
      }}
      onIdentityChange={nextSignedIn => {
        setIdentityVersion(version => version + 1)
        if (nextSignedIn) {
          if (route.screen === 'login') navigate({ screen: 'home' }, { replace: true })
          return
        }
        navigate({ screen: 'login' }, { replace: true })
      }}
    />
  )

  // Before sign-in there are no workspaces and nowhere to switch — show the bare
  // join screen without the rail. Once an identity exists, the rail is persistent.
  if (!identityEmail) {
    return (
      <>
        <Suspense fallback={<div className="flex h-full items-center justify-center" role="status">Loading…</div>}>
          {content}
        </Suspense>
        {consentBanner}
      </>
    )
  }

  return (
    <>
      <div className="flex h-dvh min-h-0 max-sm:flex-col-reverse">
        <WorkspaceRail
          workspaces={railWorkspaces}
          activeWorkspaceId={session?.workspaceId}
          onHome={route.screen === 'home' || route.screen === 'devices' || route.screen === 'account' || route.screen === 'storage'}
          onSync={route.screen === 'sync'}
          onSelectWorkspace={switchWorkspace}
          onHomeSelect={goHome}
          onSyncSelect={() => navigate({ screen: 'sync' })}
          onCreateWorkspace={createWorkspace}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="flex h-full items-center justify-center" role="status">Loading…</div>}>
            {content}
          </Suspense>
        </div>
      </div>
      {consentBanner}
      {friendInviteNotice && (
        <div className="toast toast-end toast-top z-50" data-testid="friend-request-notification">
          <div className="alert alert-info shadow-lg" role="status" aria-live="polite">
            <span><strong>{friendInviteNotice.fromName}</strong> sent you a friend request.</span>
            <button type="button" className="btn btn-sm" onClick={() => { navigate({ screen: 'home' }); setFriendInviteNotice(null) }}>Open</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFriendInviteNotice(null)}>Dismiss</button>
          </div>
        </div>
      )}
    </>
  )
}

export default App
