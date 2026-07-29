import { lazy, Suspense, useEffect, useState } from 'react'
import { configureRuntimeAuthCredentialProvider } from '@peerly/core'
import { DeviceIdentity } from './collab/deviceIdentity'
import { loadStoredProfile, saveStoredProfile } from './collab/profileStore'
import { shouldRaiseNotification } from './collab/attentionPolicy'
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
import { useIdentityRenewal } from './hooks/useIdentityRenewal'
import { useSessionBootstrap } from './hooks/useSessionBootstrap'
import { useWorkspaceNavigation } from './hooks/useWorkspaceNavigation'
import { usePresenceLobby } from './hooks/usePresenceLobby'
import { useWorkspaceAuth } from './hooks/useWorkspaceAuth'
import {
  rememberWorkspace,
  snapshotWorkspace,
  workspacesForEmail,
  WORKSPACES_CHANGED_EVENT,
  type StoredWorkspace,
} from './collab/workspaceStore'
import {
  hydrateSessionAvatar,
  loadIdentityEmail,
  loadIdentityProvider,
  loadIdentityUserId,
  loadIdToken,
  loadSignedInIdentity,
  saveSession,
} from './session'
import type { IncomingFriendInvite } from './collab/friendInviteStore'
import { loadDmNotificationsEnabled } from './collab/notificationPreference'
import { DEFAULT_USER_COLOR } from './config'
import type { UserProfile } from './types'
import type { IncomingWorkspaceInvite } from './collab/workspaceInviteStore'
import { resolveAvatarPreview } from './collab/avatarService'
import { AppVersionBadge } from './components/AppVersionBadge'

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

function AppContent() {
  const { session, setSession, ready } = useSessionBootstrap()
  const [, setIdentityVersion] = useState(0)
  const hasRememberedIdentity = Boolean(loadIdentityEmail() && loadIdentityProvider())
  const signedIn = Boolean(loadSignedInIdentity()) || hasRememberedIdentity
  const { route, navigate, pickerTab, workspaceRoute, enterWorkspace, leaveToPicker, setPickerTab, setWorkspaceRoute } =
    useAppRouting(session?.workspaceRouteId, signedIn, ready)
  const [legalAccepted, setLegalAccepted] = useState(() => hasAcceptedCurrentLegal())
  const acceptLegal = () => {
    acceptCurrentLegal()
    setLegalAccepted(true)
  }

  // Friends outlive the open workspace — use durable identity userId on home too.
  const ownerUserId = session?.identityUserId ?? loadIdentityUserId() ?? undefined
  // App-wide, not inside the workspace: a token expiring on the friends or DM
  // screen used to have nothing offering to renew it.
  useIdentityRenewal(deviceIdentity, hasRememberedIdentity)
  const friendsApi = useFriends(deviceIdentity, ownerUserId)
  const reloadFriends = friendsApi.reload
  const deviceSyncVersion = useApprovedDeviceSync(deviceIdentity, ownerUserId)
  useEffect(() => {
    reloadFriends()
  }, [deviceSyncVersion, reloadFriends])

  const storedProfile = loadStoredProfile()
  const [globalAvatarPreview, setGlobalAvatarPreview] = useState<string | undefined>(
    session?.avatar
  )
  useEffect(() => {
    if (session?.avatar) {
      setGlobalAvatarPreview(session.avatar)
      return
    }
    let cancelled = false
    void resolveAvatarPreview(storedProfile.avatarId).then(preview => {
      if (!cancelled) setGlobalAvatarPreview(preview)
    })
    return () => {
      cancelled = true
    }
  }, [session?.avatar, storedProfile.avatarId])

  const lobbyProfile = (() => {
    const email = session?.identityEmail ?? loadIdentityEmail()
    const userId = session?.identityUserId ?? loadIdentityUserId()
    if (!email || !userId) return null
    const name =
      session?.userName ??
      storedProfile.userName ??
      email.split('@')[0] ??
      userId.slice(0, 12)
    return {
      userId,
      name,
      email,
      color: session?.color ?? storedProfile.color ?? DEFAULT_USER_COLOR,
      avatar: session?.avatar ?? globalAvatarPreview,
    }
  })()

  const [pendingDmRing, setPendingDmRing] = useState<DmRingPayload | null>(null)
  const [friendInviteNotice, setFriendInviteNotice] = useState<IncomingFriendInvite | null>(null)
  const [pendingWorkspaceDm, setPendingWorkspaceDm] = useState<{
    userId: string
    text: string
  } | null>(null)

  const notifyFriendInvite = (invite: IncomingFriendInvite) => {
    setFriendInviteNotice(invite)
    const supported = typeof Notification !== 'undefined'
    if (!shouldRaiseNotification({
      visibility: document.visibilityState,
      enabled: loadDmNotificationsEnabled(),
      supported,
      permission: supported ? Notification.permission : 'denied',
    })) return

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

  const notifyWorkspaceInvite = (invite: IncomingWorkspaceInvite) => {
    const supported = typeof Notification !== 'undefined'
    if (!shouldRaiseNotification({
      visibility: document.visibilityState,
      enabled: loadDmNotificationsEnabled(),
      supported,
      permission: supported ? Notification.permission : 'denied',
    })) return

    const notification = new Notification('Peerly workspace invitation', {
      body: `${invite.fromName} invited you to ${invite.payload.invite.workspaceName}.`,
      icon: '/icon-192.png',
      tag: `peerly-workspace-${invite.payload.invite.workspaceId}`,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
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
    onWorkspaceInvite: notifyWorkspaceInvite,
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

  const {
    updateSession, goHome, switchWorkspace, createWorkspace, signOut,
  } = useWorkspaceNavigation({
    currentWorkspaceId: session?.workspaceId,
    setSession,
    onIdentityChanged: () => setIdentityVersion(version => version + 1),
    navigate,
    enterWorkspace,
    leaveToPicker,
  })

  const accountProfile: UserProfile = {
    name:
      session?.userName ??
      storedProfile.userName ??
      lobbyProfile?.name ??
      (session?.identityEmail ?? loadIdentityEmail())?.split('@')[0] ??
      'Peerly user',
    color: session?.color ?? storedProfile.color ?? DEFAULT_USER_COLOR,
    avatar: session?.avatar ?? globalAvatarPreview,
  }

  const updateGlobalProfile = (next: UserProfile & { avatarId?: string }) => {
    saveStoredProfile({
      userName: next.name,
      color: next.color,
      avatarId: next.avatarId,
    })
    setSession(previous => {
      if (!previous) return previous
      const updated = {
        ...previous,
        userName: next.name,
        color: next.color,
        avatar: next.avatar,
        avatarId: next.avatarId,
      }
      saveSession(updated)
      return updated
    })
    setIdentityVersion(version => version + 1)
  }

  // Rail data: the signed-in email drives which workspaces to offer, and it
  // survives leaving a workspace (identity outlives the active session), so the
  // rail stays populated on the home view too. loadIdentityEmail() reads even
  // when the token has expired — listing is a UX filter, not authorization.
  const identityEmail = session?.identityEmail ?? loadIdentityEmail() ?? undefined
  // Held in state and refreshed on the store's own event. It used to be read
  // during render, and a localStorage write tells React nothing — so a
  // forgotten workspace stayed in the rail until something unrelated
  // repainted, which looked like the deletion had failed.
  const [railWorkspaces, setRailWorkspaces] = useState<StoredWorkspace[]>([])
  useEffect(() => {
    const refresh = () => setRailWorkspaces(identityEmail ? workspacesForEmail(identityEmail) : [])
    refresh()
    window.addEventListener(WORKSPACES_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(WORKSPACES_CHANGED_EVENT, refresh)
  }, [identityEmail])

  const workspaceInviteNotice = presence.incomingWorkspace[0] ?? null
  const openWorkspaceInvitation = async (invite: IncomingWorkspaceInvite) => {
    const workspace = {
      ...invite.payload.invite,
      lastOpenedAt: Date.now(),
    }
    rememberWorkspace(invite.payload.invite)
    presence.dismissWorkspaceInvite(invite.inviteId)
    await switchWorkspace(workspace)
  }

  // Public legal pages render regardless of session/hydration state.
  if (route.screen === 'legal') {
    return (
      <LegalPage
        doc={route.doc}
        onBack={() => navigate(session ? defaultWorkspaceRoute(session.workspaceRouteId) : signedIn ? { screen: 'home' } : { screen: 'login' })}
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
      onRequestFriend={presence.inviteByEmail}
      onSendGlobalDm={(userId, text) => {
        setPendingWorkspaceDm({ userId, text })
        navigate({ screen: 'home', dmUserId: userId })
      }}
      onOpenProfile={() => navigate({ screen: 'account' })}
      onDeliverWorkspaceInvites={presence.inviteToWorkspace}
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
      accountPanel={
        <AccountPreferencesPage
          email={identityEmail ?? ''}
          profile={accountProfile}
          avatarId={session?.avatarId ?? storedProfile.avatarId}
          onProfileChange={updateGlobalProfile}
          onBack={() => {
            if (session) enterWorkspace(session.workspaceRouteId)
            else navigate({ screen: 'home' })
          }}
          onSignOut={signOut}
        />
      }
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
      dmUserId={route.screen === 'home' ? route.dmUserId : undefined}
      pendingMessage={
        route.screen === 'home' && pendingWorkspaceDm && pendingWorkspaceDm.userId === route.dmUserId
          ? pendingWorkspaceDm.text
          : undefined
      }
      onPendingMessageConsumed={() => setPendingWorkspaceDm(null)}
      onOpenDm={userId =>
        navigate(userId ? { screen: 'home', dmUserId: userId } : { screen: 'home' })
      }
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
        if (route.screen !== 'devices') enterWorkspace(next.workspaceRouteId)
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
      {workspaceInviteNotice && (
        <div className="toast toast-end toast-top z-50" data-testid="workspace-invite-notification">
          <div className="alert alert-info shadow-lg" role="status" aria-live="polite">
            <span>
              <strong>{workspaceInviteNotice.fromName}</strong>{' '}
              invited you to <strong>{workspaceInviteNotice.payload.invite.workspaceName}</strong>.
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void openWorkspaceInvitation(workspaceInviteNotice)}
            >
              Join
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => presence.dismissWorkspaceInvite(workspaceInviteNotice.inviteId)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function App() {
  return (
    <>
      <AppContent />
      <AppVersionBadge />
    </>
  )
}

export default App
