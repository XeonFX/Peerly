import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addWorkspaceChannel,
  channelIds,
  GENERAL_CHANNEL,
  getChannelById,
  loadAllWorkspaceChannels,
} from '../collab/channelStore'
import { ensureDmChannel } from '../collab/dmStore'
import { CollabProvider } from '../context/CollabContext'
import {
  useChatSlice,
  useConnectionSlice,
  useProfileSlice,
  useWorkspaceSlice,
} from '../context/useCollabSlices'
import type { PeerHandshake } from '@trystero-p2p/core'
import { encodeInviteLink } from '../collab/inviteLink'
import { useBrowserStorage } from '../hooks/useBrowserStorage'
import type { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { rememberWorkspace, snapshotWorkspace } from '../collab/workspaceStore'
import { sessionProfile, type Session } from '../session'
import type { Channel, Peer, UserProfile } from '../types'
import { FilesPanel } from './FilesPanel'
import { StoragePressureBanner } from './BrowserStorageCard'
import { Sidebar } from './Sidebar'
import { ChannelPanel } from './workspace/ChannelPanel'
import { ProfilePanel } from './workspace/ProfilePanel'
import { WorkspaceSettingsPanel } from './workspace/WorkspaceSettingsPanel'

type Props = {
  session: Session
  peerHandshake?: PeerHandshake
  /** Handshake-verified peerId -> durable user id. See useWorkspaceAuth. */
  resolvePeerUserId?: (peerId: string) => string | undefined
  /** Needed to re-sign the allow-list when inviting; only the creator's device can. */
  authManager: WorkspaceAuthManager | null
  onSessionChange: (patch: Partial<Session>) => void
  onLeave: () => void
}

function WorkspaceShell({
  session,
  channels,
  activeChannel,
  activeView,
  showFiles,
  canInvite,
  onInvite,
  sidebarOpen,
  onSidebarOpenChange,
  onChannelSelect,
  onChannelsUpdated,
  onProfileSelect,
  onWorkspaceSettings,
  onLeave,
  onToggleFiles,
  onWorkspaceNameChange,
  onWorkspaceAvatarChange,
  onWorkspaceAvatarClear,
}: {
  session: Session
  channels: Channel[]
  activeChannel: string
  activeView: 'channel' | 'profile' | 'workspace'
  showFiles: boolean
  canInvite: boolean
  onInvite: (emails: string[]) => Promise<void>
  sidebarOpen: boolean
  onSidebarOpenChange: (open: boolean) => void
  onChannelSelect: (id: string) => void
  onChannelsUpdated: () => void
  onProfileSelect: () => void
  onWorkspaceSettings: () => void
  onLeave: () => void
  onToggleFiles: () => void
  onWorkspaceNameChange: (name: string) => void
  onWorkspaceAvatarChange: (avatarId: string, preview: string) => void
  onWorkspaceAvatarClear: () => void
}) {
  const { announceChannel } = useWorkspaceSlice()
  const {
    connectionStatus,
    connectionError,
    relayOnline,
    rtcPeerCount,
    relayUrls,
    p2pCapability,
    retryP2pCapability,
  } = useConnectionSlice()
  const { sharedFiles, transfers, unreadByChannel, requestFile } = useChatSlice()
  const browserStorage = useBrowserStorage(transfers.length > 0)
  const { selfId, profile, peers } = useProfileSlice()
  const channel = getChannelById(channels, activeChannel)

  const handleAddChannel = async (name: string) => {
    const created = addWorkspaceChannel(session.workspaceId, name)
    if (!created) return
    onChannelsUpdated()
    await announceChannel(created)
    onChannelSelect(created.id)
  }

  const handleStartDirectMessage = async (peer: Peer) => {
    const dm = ensureDmChannel(session.workspaceId, peer, selfId)
    onChannelsUpdated()
    await announceChannel(dm)
    onChannelSelect(dm.id)
  }

  // Selecting anything on a phone should reveal what you selected.
  const selectAndClose = (id: string) => {
    onChannelSelect(id)
    onSidebarOpenChange(false)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Backdrop for the off-canvas sidebar; inert on desktop where it is static. */}
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 cursor-pointer bg-black/55 lg:hidden"
          aria-label="Close workspace menu"
          onClick={() => onSidebarOpenChange(false)}
        />
      )}
      <Sidebar
        open={sidebarOpen}
        workspace={session.workspaceName}
        workspaceAvatar={session.workspaceAvatar}
        inviteLink={encodeInviteLink({
          v: 1,
          workspaceId: session.workspaceId,
          workspaceName: session.workspaceName,
          creatorKeyId: session.creatorKeyId,
          allowList: session.allowList,
        })}
        canInvite={canInvite}
        invitedEmails={session.allowList.emails}
        onInvite={onInvite}
        channels={channels}
        activeChannel={activeChannel}
        activeView={activeView}
        peers={peers}
        selfProfile={profile}
        connectionStatus={connectionStatus}
        relayOnline={relayOnline}
        rtcPeerCount={rtcPeerCount}
        p2pCapability={p2pCapability}
        connectionError={connectionError}
        relayUrls={relayUrls}
        onChannelSelect={selectAndClose}
        onAddChannel={handleAddChannel}
        onStartDirectMessage={handleStartDirectMessage}
        onProfileSelect={() => {
          onProfileSelect()
          onSidebarOpenChange(false)
        }}
        onWorkspaceSettings={() => {
          onWorkspaceSettings()
          onSidebarOpenChange(false)
        }}
        onLeave={onLeave}
        unreadByChannel={unreadByChannel}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <StoragePressureBanner
          pressure={browserStorage.pressure}
          availableBytes={browserStorage.estimate.availableBytes}
          onManage={onWorkspaceSettings}
        />
        {activeView === 'profile' ? (
          <ProfilePanel
            workspace={session.workspaceName}
            inviteLink={encodeInviteLink({
              v: 1,
              workspaceId: session.workspaceId,
              workspaceName: session.workspaceName,
              creatorKeyId: session.creatorKeyId,
              allowList: session.allowList,
            })}
            onBack={() => onChannelSelect(activeChannel)}
          />
        ) : activeView === 'workspace' ? (
          <WorkspaceSettingsPanel
            workspaceId={session.workspaceId}
            workspaceName={session.workspaceName}
            workspaceAvatar={session.workspaceAvatar}
            workspaceAvatarId={session.workspaceAvatarId}
            browserStorage={browserStorage}
            p2pCapability={p2pCapability}
            rtcPeerCount={rtcPeerCount}
            connectionError={connectionError}
            onRetryP2p={retryP2pCapability}
            onNameChange={onWorkspaceNameChange}
            onAvatarChange={onWorkspaceAvatarChange}
            onAvatarClear={onWorkspaceAvatarClear}
            onBack={() => onChannelSelect(activeChannel)}
          />
        ) : (
          <ChannelPanel
            channel={channel}
            onToggleFiles={onToggleFiles}
            showFiles={showFiles}
            onOpenSidebar={() => onSidebarOpenChange(true)}
          />
        )}
      </main>

      {activeView === 'channel' && showFiles && (
        <FilesPanel files={sharedFiles} transfers={transfers} onRequestFile={requestFile} />
      )}
    </div>
  )
}

export function Workspace({ session, peerHandshake, resolvePeerUserId, authManager, onSessionChange, onLeave }: Props) {
  const [channels, setChannels] = useState(() => loadAllWorkspaceChannels(session.workspaceId))
  const [activeChannel, setActiveChannel] = useState(GENERAL_CHANNEL.id)
  const [activeView, setActiveView] = useState<'channel' | 'profile' | 'workspace'>('channel')
  // Start with the conversation at full width. The files rail remains one click
  // away and no longer opens as a large empty column in a new channel.
  const [showFiles, setShowFiles] = useState(false)
  const [canInvite, setCanInvite] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Whether this device holds the creator key. Async because the device key is
  // read from IndexedDB; default false so the invite UI never flashes for
  // someone who cannot actually use it.
  useEffect(() => {
    let cancelled = false
    void authManager?.canInvite().then(allowed => {
      if (!cancelled) setCanInvite(allowed)
    })
    return () => {
      cancelled = true
    }
  }, [authManager])

  /**
   * Add members to this workspace: re-sign the allow-list, then persist it.
   *
   * Existing peers need no action — the new member presents the newer signed
   * list during their own handshake and everyone adopts it (see
   * WorkspaceAuthManager.addMembers).
   */
  const handleInvite = useCallback(
    async (emails: string[]) => {
      if (!authManager) throw new Error('Workspace is still connecting — try again in a moment')
      const allowList = await authManager.addMembers(emails)
      const next = { ...session, allowList }
      onSessionChange({ allowList })
      rememberWorkspace(snapshotWorkspace(next))
    },
    [authManager, onSessionChange, session]
  )

  const persistWorkspaceAppearance = useCallback(
    (patch: Partial<Session>) => {
      onSessionChange(patch)
      rememberWorkspace(snapshotWorkspace({ ...session, ...patch }))
    },
    [onSessionChange, session]
  )

  const profile = useMemo(() => sessionProfile(session), [session])
  const ids = useMemo(() => channelIds(channels), [channels])

  const handleProfileChange = (next: UserProfile & { avatarId?: string }) => {
    onSessionChange({
      userName: next.name,
      color: next.color,
      avatar: next.avatar,
      avatarId: next.avatarId,
    })
  }

  const openChannel = (id: string) => {
    setActiveChannel(id)
    setActiveView('channel')
  }

  const refreshChannels = useCallback(() => {
    setChannels(loadAllWorkspaceChannels(session.workspaceId))
  }, [session.workspaceId])

  return (
    <CollabProvider
      workspaceId={session.workspaceId}
      channelId={activeChannel}
      channelIds={ids}
      activeView={activeView}
      profile={profile}
      avatarId={session.avatarId}
      workspaceSecret={session.workspaceId}
      peerHandshake={peerHandshake}
      selfUserId={session.identityUserId}
      resolvePeerUserId={resolvePeerUserId}
      onProfileChange={handleProfileChange}
      onChannelsChange={refreshChannels}
    >
      <WorkspaceShell
        session={session}
        channels={channels}
        activeChannel={activeChannel}
        activeView={activeView}
        showFiles={showFiles}
        canInvite={canInvite}
        onInvite={handleInvite}
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        onChannelSelect={openChannel}
        onChannelsUpdated={refreshChannels}
        onProfileSelect={() => setActiveView('profile')}
        onWorkspaceSettings={() => setActiveView('workspace')}
        onLeave={onLeave}
        onToggleFiles={() => setShowFiles(value => !value)}
        onWorkspaceNameChange={name => persistWorkspaceAppearance({ workspaceName: name })}
        onWorkspaceAvatarChange={(avatarId, preview) =>
          persistWorkspaceAppearance({ workspaceAvatarId: avatarId, workspaceAvatar: preview })
        }
        onWorkspaceAvatarClear={() =>
          persistWorkspaceAppearance({ workspaceAvatarId: undefined, workspaceAvatar: undefined })
        }
      />
    </CollabProvider>
  )
}
