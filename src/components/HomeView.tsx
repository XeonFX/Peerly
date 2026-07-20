import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { Avatar } from './Avatar'
import { BrowserStorageCard } from './BrowserStorageCard'
import { P2pCapabilityIndicator } from './P2pCapabilityIndicator'
import { useI18n } from '../i18n'
import { useBrowserStorage } from '../hooks/useBrowserStorage'
import { useP2pCapability } from '../hooks/useP2pCapability'
import type { IncomingFriendInvite, OutgoingFriendInvite } from '../collab/friendInviteStore'

type Props = {
  section: 'friends' | 'devices' | 'account' | 'storage'
  onSectionChange: (section: Props['section']) => void
  devicesPanel: ReactNode
  accountPanel: ReactNode
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

const HOME_SIDEBAR_KEY = 'peerly-home-sidebar-width-v1'
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 420

function initialSidebarWidth(): number {
  if (typeof localStorage === 'undefined') return 280
  const stored = Number(localStorage.getItem(HOME_SIDEBAR_KEY))
  return Number.isFinite(stored)
    ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
    : 280
}

/**
 * Signed-in home: Discord-style Friends/DM navigation. The compact left list
 * chooses a destination; Friends or the selected conversation owns the main pane.
 */
export function HomeView({
  section,
  onSectionChange,
  devicesPanel,
  accountPanel,
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
  const browserStorage = useBrowserStorage()
  const { capability: p2pCapability } = useP2pCapability()
  const [activeFriend, setActiveFriend] = useState<Friend | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [ringBanner, setRingBanner] = useState<DmRingPayload | null>(null)
  const [query, setQuery] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    resizeCleanupRef.current?.()
    const move = (moveEvent: PointerEvent) => {
      const railWidth = document.querySelector<HTMLElement>('[data-testid="workspace-rail"]')?.offsetWidth ?? 64
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, moveEvent.clientX - railWidth))
      setSidebarWidth(next)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      resizeCleanupRef.current = null
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    resizeCleanupRef.current = stop
  }

  useEffect(() => {
    try { localStorage.setItem(HOME_SIDEBAR_KEY, String(sidebarWidth)) } catch { /* private mode */ }
  }, [sidebarWidth])

  const openFriend = useCallback(
    async (friend: Friend) => {
      onSectionChange('friends')
      setActiveFriend(friend)
      const secret = friendDmSecret(friend)
      if (!secret) {
        setRoomCode(null)
        return
      }
      const code = await dmRoomCode(profile.userId, friend.subjectUserId, secret)
      setRoomCode(code)
    },
    [profile.userId, onSectionChange]
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

  const visibleFriends = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return friends
    return friends.filter(friend =>
      `${friend.subjectName} ${friend.subjectEmail ?? ''}`.toLocaleLowerCase().includes(needle)
    )
  }, [friends, query])

  const selectSection = (next: Props['section']) => {
    setActiveFriend(null)
    setRoomCode(null)
    setQuery('')
    onSectionChange(next)
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 bg-base-100" data-testid="home-view">
      {ringBanner && (
        <div
          className="absolute left-3 right-3 top-3 z-30 flex items-center gap-2 rounded-box border border-primary/30 bg-base-100 px-3 py-2 text-sm shadow-lg"
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

      <aside
        className="relative flex h-full shrink-0 flex-col border-r border-base-300/80 bg-base-200/65"
        style={{ width: sidebarWidth }}
        aria-label={tr('Direct messages')}
        data-testid="home-sidebar"
      >
        <div className="shrink-0 border-b border-base-300/70 p-3">
          <label className="input input-sm flex w-full items-center gap-2 bg-base-100/80">
            <Icon name="search" size={15} className="text-base-content/45" />
            <input
              type="search"
              className="min-w-0 grow"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={tr('Search messages or people')}
              aria-label={tr('Search messages or people')}
              data-testid="home-message-search"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium ${
              section === 'friends' && !activeFriend ? 'bg-base-300 text-base-content' : 'hover:bg-base-300/70'
            }`}
            data-testid="home-friends-tab"
            aria-current={section === 'friends' && !activeFriend || undefined}
            onClick={() => selectSection('friends')}
          >
            <Icon name="user" size={17} />
            {tr('Friends')}
            {incoming.length > 0 && (
              <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs text-primary-content">
                {incoming.length}
              </span>
            )}
          </button>
          <SidebarDestination icon="shield" label={tr('My devices')} active={section === 'devices'} testId="home-devices-tab" onClick={() => selectSection('devices')} />
          <SidebarDestination icon="user" label={tr('Profile & preferences')} active={section === 'account'} testId="home-account-tab" onClick={() => selectSection('account')} />
          <SidebarDestination icon="archive" label={tr('Browser storage')} active={section === 'storage'} testId="home-storage-tab" onClick={() => selectSection('storage')} />
          <h2 className="mb-1 mt-4 px-3 text-[0.65rem] font-semibold uppercase tracking-wider text-base-content/50">
            {tr('Direct messages')}
          </h2>
          {visibleFriends.length === 0 ? (
            <p className="px-3 py-2 text-xs text-base-content/45">{tr('No friends yet.')}</p>
          ) : (
            <ul className="space-y-0.5" data-testid="direct-message-list">
              {visibleFriends.map(friend => {
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
                      <span className="relative shrink-0">
                        <Avatar name={friend.subjectName} color="#5865f2" size="sm" />
                        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-base-200 ${online ? 'bg-success' : 'bg-base-content/30'}`} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{friend.subjectName}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="shrink-0 border-t border-base-300/70 px-3 py-2">
          <P2pCapabilityIndicator capability={p2pCapability} rtcPeerCount={0} compact />
        </div>
        <button
          type="button"
          className="absolute -right-1 top-0 z-20 hidden h-full w-2 cursor-col-resize touch-none md:block"
          aria-label={tr('Resize navigation sidebar')}
          title={tr('Drag to resize navigation sidebar')}
          data-testid="home-sidebar-resizer"
          onPointerDown={beginResize}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            setSidebarWidth(width => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width + (event.key === 'ArrowRight' ? 16 : -16))))
          }}
        >
          <span className="mx-auto block h-full w-px bg-transparent transition-colors hover:bg-primary/50" />
        </button>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-base-100">
          {section === 'friends' && activeFriend && roomCode ? (
            <GlobalDmChat
              friendName={activeFriend.subjectName}
              friendEmail={activeFriend.subjectEmail}
              friendOnline={friendOnline}
              partnerInRoom={chat.partnerInRoom}
              messages={chat.messages}
              selfUserId={profile.userId}
              error={chat.error}
              searchQuery={query}
              onSend={chat.sendMessage}
              onFiles={chat.sendFiles}
              onToggleReaction={chat.toggleReaction}
              reactions={chat.reactions}
              attachmentUrls={chat.attachmentUrls}
              transfers={chat.transfers}
              onEdit={chat.editMessage}
              onDelete={chat.deleteMessage}
              onClose={() => {
                setActiveFriend(null)
                setRoomCode(null)
              }}
            />
          ) : section === 'friends' ? (
            <main className="h-full overflow-y-auto bg-base-100">
              <header className="sticky top-0 z-10 flex h-[3.65rem] items-center border-b border-base-300/70 bg-base-100/95 px-5 backdrop-blur">
                <Icon name="user" size={18} className="mr-2 text-base-content/55" />
                <h1 className="font-semibold">{tr('Friends')}</h1>
              </header>
              <div className="mx-auto max-w-5xl p-5 sm:p-7">
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
              </div>
            </main>
          ) : section === 'devices' ? devicesPanel : section === 'account' ? accountPanel : (
            <main className="h-full overflow-y-auto bg-base-200 p-6 sm:p-10" data-testid="browser-storage-page">
              <div className="mx-auto max-w-3xl">
                <h1 className="text-2xl font-bold">{tr('Browser storage')}</h1>
                <p className="mt-2 text-sm text-base-content/65">{tr('Manage files and data kept locally by this browser.')}</p>
                <div className="mt-6">
                  <BrowserStorageCard
                    estimate={browserStorage.estimate}
                    pressure={browserStorage.pressure}
                    onRefresh={() => void browserStorage.refresh(true)}
                    onRequestPersistence={browserStorage.requestPersistence}
                    requestingPersistence={browserStorage.requestingPersistence}
                  />
                </div>
              </div>
            </main>
          )}
      </div>
    </div>
  )
}

function SidebarDestination({ icon, label, active, testId, onClick }: {
  icon: 'shield' | 'user' | 'archive'
  label: string
  active: boolean
  testId: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`mt-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium ${active ? 'bg-base-300 text-base-content' : 'text-base-content/75 hover:bg-base-300/70 hover:text-base-content'}`}
      onClick={onClick}
      aria-current={active || undefined}
      data-testid={testId}
    >
      <Icon name={icon} size={17} />
      <span className="truncate">{label}</span>
    </button>
  )
}
