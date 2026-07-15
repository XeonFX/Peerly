import { useCallback, useMemo, useState } from 'react'
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
import { sessionProfile, type Session } from '../session'
import type { Channel, Peer, UserProfile } from '../types'
import { FilesPanel } from './FilesPanel'
import { Sidebar } from './Sidebar'
import { ChannelPanel } from './workspace/ChannelPanel'
import { ProfilePanel } from './workspace/ProfilePanel'

type Props = {
  session: Session
  peerHandshake?: PeerHandshake
  onSessionChange: (patch: Partial<Session>) => void
  onLeave: () => void
}

function WorkspaceShell({
  session,
  channels,
  activeChannel,
  activeView,
  showFiles,
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

export function Workspace({ session, peerHandshake, onSessionChange, onLeave }: Props) {
  const [channels, setChannels] = useState(() => loadAllWorkspaceChannels(session.workspaceId))
  const [activeChannel, setActiveChannel] = useState(GENERAL_CHANNEL.id)
  const [activeView, setActiveView] = useState<'channel' | 'profile'>('channel')
  const [showFiles, setShowFiles] = useState(true)

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
        onChannelSelect={openChannel}
        onChannelsUpdated={refreshChannels}
        onProfileSelect={() => setActiveView('profile')}
        onLeave={onLeave}
        onToggleFiles={() => setShowFiles(value => !value)}
      />
    </CollabProvider>
  )
}