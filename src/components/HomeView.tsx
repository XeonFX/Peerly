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
import { Icon } from './Icon'
import { useI18n } from '../i18n'
import type { IncomingFriendInvite, OutgoingFriendInvite } from '../collab/friendInviteStore'

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
}

/**
 * Signed-in home: Discord-style Friends/DM navigation. The compact left list
 * chooses a destination; Friends or the selected conversation owns the main pane.
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

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-box border border-base-300/80 bg-base-100/70 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-base-300/70 bg-base-200/50 p-2 md:border-b-0 md:border-r" aria-label={tr('Direct messages')}>
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium ${
              activeFriend ? 'hover:bg-base-300/70' : 'bg-base-300 text-base-content'
            }`}
            data-testid="home-friends-tab"
            aria-current={!activeFriend || undefined}
            onClick={() => {
              setActiveFriend(null)
              setRoomCode(null)
            }}
          >
            <Icon name="user" size={17} />
            {tr('Friends')}
            {incoming.length > 0 && (
              <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs text-primary-content">
                {incoming.length}
              </span>
            )}
          </button>
          <h2 className="mb-1 mt-4 px-3 text-[0.65rem] font-semibold uppercase tracking-wider text-base-content/50">
            {tr('Direct messages')}
          </h2>
          {friends.length === 0 ? (
            <p className="px-3 py-2 text-xs text-base-content/45">{tr('No friends yet.')}</p>
          ) : (
            <ul className="space-y-0.5" data-testid="direct-message-list">
              {friends.map(friend => {
                const online = isUserOnline(friend.subjectUserId)
                const active = activeFriend?.subjectUserId === friend.subjectUserId
                const canMessage = Boolean(friendDmSecret(friend))
                return (
                  <li key={friend.subjectUserId}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                        active ? 'bg-primary/15 text-primary' : 'text-base-content/75 hover:bg-base-300/70 hover:text-base-content'
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                      data-testid={`direct-message-${friend.subjectUserId}`}
                      disabled={!canMessage}
                      title={canMessage ? tr('Message {name}', { name: friend.subjectName }) : tr('Remove and invite this friend again to enable secure messages.')}
                      onClick={() => void openFriend(friend)}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-success' : 'bg-base-content/25'}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{friend.subjectName}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <main className="min-h-0 min-w-0 p-3 sm:p-4">
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
            <FriendsPanel
              friends={friends}
              outgoing={outgoing}
              incoming={incoming}
              onlineCount={onlineCount}
              isUserOnline={isUserOnline}
              onMessageFriend={friend => void openFriend(friend)}
              onInvite={onInvite}
              onAccept={onAccept}
              onDecline={onDecline}
              onCancelOutgoing={onCancelOutgoing}
              onRemoveFriend={onRemoveFriend}
            />
          )}
        </main>
      </div>
    </div>
  )
}
