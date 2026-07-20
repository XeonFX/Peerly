import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Friend } from '../collab/friendsStore'
import { friendDmDeviceKey, friendDmSecret } from '../collab/friendsStore'
import { dmRoomCode } from '../collab/dmCode'
import type { DmRingPayload } from '../collab/dmRing'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import { useGlobalDmChat } from '../hooks/useGlobalDmChat'
import type { LobbyProfile } from '../hooks/usePresenceLobby'
import { FriendsPanel } from './FriendsPanel'
import { GlobalDmChat } from './GlobalDmChat'
import { useI18n } from '../i18n'
import type { IncomingFriendInvite, OutgoingFriendInvite } from '../collab/friendInviteStore'
import type { StoredWorkspace } from '../collab/workspaceStore'
import { WorkspaceAvatar } from './WorkspaceAvatar'

type Props = {
  profile: LobbyProfile
  identity: DeviceIdentity
  friends: Friend[]
  outgoing: OutgoingFriendInvite[]
  incoming: IncomingFriendInvite[]
  onlineCount: number
  isUserOnline: (userId: string) => boolean
  ringDm: (
    toUserId: string,
    reason: 'open' | 'message',
    preview?: string
  ) => boolean
  onInvite: (email: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onAccept: (inviteId: string) => Promise<boolean>
  onDecline: (inviteId: string) => Promise<boolean>
  onCancelOutgoing: (inviteId: string) => void
  onRemoveFriend: (userId: string) => void
  /** Incoming lobby ring from App (open that DM). */
  pendingRing: DmRingPayload | null
  onConsumeRing: () => void
  recentWorkspace?: StoredWorkspace
  onOpenWorkspace: (workspace: StoredWorkspace) => void
  onCreateWorkspace: () => void
  onJoinWorkspace: () => void
}

/**
 * Signed-in home: friends + global DMs on the left/main, workspaces below or
 * beside — Discord-style Direct Messages destination for the rail Home button.
 */
export function HomeView({
  profile,
  identity,
  friends,
  outgoing,
  incoming,
  onlineCount,
  isUserOnline,
  ringDm,
  onInvite,
  onAccept,
  onDecline,
  onCancelOutgoing,
  onRemoveFriend,
  pendingRing,
  onConsumeRing,
  recentWorkspace,
  onOpenWorkspace,
  onCreateWorkspace,
  onJoinWorkspace,
}: Props) {
  const { tr } = useI18n()
  const [activeFriend, setActiveFriend] = useState<Friend | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [ringBanner, setRingBanner] = useState<DmRingPayload | null>(null)

  const openFriend = useCallback(
    async (friend: Friend) => {
      setActiveFriend(friend)
      const secret = friendDmSecret(friend)
      if (!secret) {
        setRoomCode(null)
        return
      }
      const code = await dmRoomCode(profile.userId, friend.subjectUserId, secret)
      setRoomCode(code)
    },
    [profile.userId]
  )

  // Handle lobby ring: open or banner.
  useEffect(() => {
    if (!pendingRing) return
    const friend = friends.find(f => f.subjectUserId === pendingRing.fromUserId)
    if (friend) {
      void openFriend(friend)
      onConsumeRing()
      return
    }
    setRingBanner(pendingRing)
    onConsumeRing()
  }, [pendingRing, friends, openFriend, onConsumeRing])

  const ringFriend = useCallback(
    (reason: 'open' | 'message', preview?: string) => {
      if (!activeFriend || !roomCode) return false
      return ringDm(activeFriend.subjectUserId, reason, preview)
    },
    [activeFriend, roomCode, ringDm]
  )

  const chat = useGlobalDmChat({
    roomCode,
    identity,
    profile,
    friendUserId: activeFriend?.subjectUserId ?? null,
    friendDeviceKeyId: friendDmDeviceKey(activeFriend) ?? null,
    friendName: activeFriend?.subjectName ?? null,
    ringFriend,
  })

  const friendOnline = useMemo(
    () => (activeFriend ? isUserOnline(activeFriend.subjectUserId) : false),
    [activeFriend, isUserOnline]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="home-view">
      <section className="rounded-box border border-base-300 bg-base-100/70 p-4" data-testid="home-workspace-actions">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-base-content/50">{tr('Recent workspace')}</p>
            {recentWorkspace ? (
              <button
                type="button"
                className="mt-2 flex items-center gap-2 rounded-box px-2 py-1.5 text-left hover:bg-base-200"
                onClick={() => onOpenWorkspace(recentWorkspace)}
                data-testid="open-recent-workspace"
              >
                <WorkspaceAvatar name={recentWorkspace.workspaceName} avatarId={recentWorkspace.workspaceAvatarId} size="md" />
                <span className="font-semibold">{recentWorkspace.workspaceName}</span>
              </button>
            ) : (
              <p className="mt-1 text-sm text-base-content/55">{tr('No workspace opened yet.')}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={onJoinWorkspace}>{tr('Join workspace')}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onCreateWorkspace}>{tr('Create workspace')}</button>
          </div>
        </div>
      </section>
      {ringBanner && (
        <div
          className="flex items-center gap-2 rounded-box border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
          role="status"
          data-testid="dm-ring-banner"
        >
          <span className="min-w-0 flex-1">
            <strong>{ringBanner.fromName}</strong>{' '}
            {ringBanner.reason === 'message'
              ? tr('sent you a message.')
              : tr('wants to chat.')}
            {ringBanner.preview ? (
              <span className="text-base-content/60"> “{ringBanner.preview}”</span>
            ) : null}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-xs"
            data-testid="dm-ring-open"
            onClick={() => {
              const friend = friends.find(f => f.subjectUserId === ringBanner.fromUserId)
              if (friend) void openFriend(friend)
              setRingBanner(null)
            }}
          >
            {tr('Open')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setRingBanner(null)}
          >
            {tr('Dismiss')}
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(16rem,20rem)_1fr]">
        <FriendsPanel
          friends={friends}
          outgoing={outgoing}
          incoming={incoming}
          onlineCount={onlineCount}
          isUserOnline={isUserOnline}
          activeDmUserId={activeFriend?.subjectUserId}
          onMessageFriend={friend => void openFriend(friend)}
          onInvite={onInvite}
          onAccept={onAccept}
          onDecline={onDecline}
          onCancelOutgoing={onCancelOutgoing}
          onRemoveFriend={onRemoveFriend}
        />

        {activeFriend && roomCode ? (
          <GlobalDmChat
            friendName={activeFriend.subjectName}
            friendEmail={activeFriend.subjectEmail}
            friendOnline={friendOnline}
            partnerInRoom={chat.partnerInRoom}
            messages={chat.messages}
            selfUserId={profile.userId}
            error={chat.error}
            onSend={chat.sendMessage}
            onEdit={chat.editMessage}
            onDelete={chat.deleteMessage}
            onClose={() => {
              setActiveFriend(null)
              setRoomCode(null)
            }}
          />
        ) : (
          <div
            className="flex min-h-[12rem] flex-col items-center justify-center rounded-box border border-dashed border-base-300 bg-base-100/50 p-6 text-center"
            data-testid="global-dm-empty"
          >
            <p className="text-sm font-medium text-base-content/80">
              {tr('Direct messages')}
            </p>
            <p className="mt-1 max-w-sm text-xs text-base-content/55">
              {activeFriend
                ? tr(
                    'This friend uses the old insecure DM format. Remove and invite them again to create a secure credential.'
                  )
                : tr(
                    'Message a friend from the list. They need to be signed in to Peerly to get a ring and join the private chat.'
                  )}
            </p>
          </div>
        )}
      </div>

    </div>
  )
}
