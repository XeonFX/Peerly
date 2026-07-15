import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addWorkspaceChannel,
  channelIds,
  GENERAL_CHANNEL,
  getChannelById,
  loadAllWorkspaceChannels,
} from '../collab/channelStore'
import { ensureDmChannel } from '../collab/dmStore'
import {
  CollabProvider,
  useChatSlice,
  useConnectionSlice,
  useProfileSlice,
  useWorkspaceSlice,
} from '../context/CollabContext'
import type { PeerHandshake } from '@trystero-p2p/core'
import { encodeInviteLink } from '../collab/inviteLink'
import type { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { rememberWorkspace } from '../collab/workspaceStore'
import { sessionProfile, type Session } from '../session'
import type { Channel, Peer, UserProfile } from '../types'
import { FilesPanel } from './FilesPanel'
import { Sidebar } from './Sidebar'
import { ChannelPanel } from './workspace/ChannelPanel'
import { ProfilePanel } from './workspace/ProfilePanel'

type Props = {
  session: Session
  peerHandshake?: PeerHandshake
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
  onChannelSelect,
  onChannelsUpdated,
  onProfileSelect,
  onLeave,
  onToggleFiles,
}: {
  session: Session
  channels: Channel[]
  activeChannel: string
  activeView: 'channel' | 'profile'
  showFiles: boolean
  canInvite: boolean
  onInvite: (emails: string[]) => Promise<void>
  onChannelSelect: (id: string) => void
  onChannelsUpdated: () => void
  onProfileSelect: () => void
  onLeave: () => void
  onToggleFiles: () => void
}) {
  const { announceChannel } = useWorkspaceSlice()
  const { connectionStatus, relayOnline, rtcPeerCount, roomId, relayUrls } = useConnectionSlice()
  const { sharedFiles, transfers, unreadByChannel } = useChatSlice()
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

  return (
    <div className="workspace">
      <Sidebar
        workspace={session.workspaceName}
        inviteLink={encodeInviteLink({
          v: 1,
          workspaceId: session.workspaceId,
          workspaceName: session.workspaceName,
          creatorKeyId: session.creatorKeyId,
          allowList: session.allowList,
        })}
        canInvite={canInvite}
        onInvite={onInvite}
        channels={channels}
        activeChannel={activeChannel}
        activeView={activeView}
        peers={peers}
        selfProfile={profile}
        connectionStatus={connectionStatus}
        relayOnline={relayOnline}
        rtcPeerCount={rtcPeerCount}
        roomId={roomId}
        relayUrls={relayUrls}
        onChannelSelect={onChannelSelect}
        onAddChannel={handleAddChannel}
        onStartDirectMessage={handleStartDirectMessage}
        onProfileSelect={onProfileSelect}
        onLeave={onLeave}
        unreadByChannel={unreadByChannel}
      />

      <main className="main-panel">
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
        ) : (
          <ChannelPanel
            channel={channel}
            workspaceProtected
            onToggleFiles={onToggleFiles}
            showFiles={showFiles}
          />
        )}
      </main>

      {activeView === 'channel' && showFiles && (
        <FilesPanel files={sharedFiles} transfers={transfers} />
      )}
    </div>
  )
}

export function Workspace({ session, peerHandshake, authManager, onSessionChange, onLeave }: Props) {
  const [channels, setChannels] = useState(() => loadAllWorkspaceChannels(session.workspaceId))
  const [activeChannel, setActiveChannel] = useState(GENERAL_CHANNEL.id)
  const [activeView, setActiveView] = useState<'channel' | 'profile'>('channel')
  const [showFiles, setShowFiles] = useState(true)
  const [canInvite, setCanInvite] = useState(false)

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
      onSessionChange({ allowList })
      rememberWorkspace({
        workspaceId: session.workspaceId,
        workspaceName: session.workspaceName,
        creatorKeyId: session.creatorKeyId,
        allowList,
      })
    },
    [authManager, onSessionChange, session.workspaceId, session.workspaceName, session.creatorKeyId]
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
        onChannelSelect={openChannel}
        onChannelsUpdated={refreshChannels}
        onProfileSelect={() => setActiveView('profile')}
        onLeave={onLeave}
        onToggleFiles={() => setShowFiles(value => !value)}
      />
    </CollabProvider>
  )
}