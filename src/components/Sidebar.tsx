import { useState } from 'react'
import { appBuildLabel } from '../config'
import type { Channel, ConnectionStatus, Peer, UserProfile } from '../types'
import { Avatar } from './Avatar'
import { ConnectionStatus as ConnectionStatusLabel } from './ConnectionStatus'

type Props = {
  workspace: string
  inviteLink?: string
  channels: Channel[]
  activeChannel: string
  activeView: 'channel' | 'profile'
  peers: Peer[]
  selfProfile: UserProfile
  connectionStatus: ConnectionStatus
  relayOnline: boolean
  rtcPeerCount: number
  roomId: string
  relayUrls: string[]
  onChannelSelect: (id: string) => void
  onAddChannel: (name: string) => void
  onStartDirectMessage: (peer: Peer) => void
  onProfileSelect: () => void
  onLeave: () => void
  unreadByChannel: Record<string, number>
}

function ChannelButton({
  channel,
  label,
  prefix,
  active,
  unread,
  onSelect,
}: {
  channel: Channel
  label: string
  prefix?: React.ReactNode
  active: boolean
  unread: number
  onSelect: () => void
}) {
  return (
    <li>
      <button
        className={`channel-item ${active ? 'active' : ''}`}
        onClick={onSelect}
        data-testid={channel.kind === 'dm' ? `dm-${channel.peerId}` : undefined}
      >
        {prefix}
        <span className="channel-name">{label}</span>
        {unread > 0 && (
          <span className="channel-unread" data-testid={`unread-${channel.id}`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </li>
  )
}

export function Sidebar({
  workspace,
  inviteLink,
  channels,
  activeChannel,
  activeView,
  peers,
  selfProfile,
  connectionStatus,
  relayOnline,
  rtcPeerCount,
  roomId,
  relayUrls,
  onChannelSelect,
  onAddChannel,
  onStartDirectMessage,
  onProfileSelect,
  onLeave,
  unreadByChannel,
}: Props) {
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')

  const publicChannels = channels.filter(channel => channel.kind !== 'dm')
  const dmChannels = channels.filter(channel => channel.kind === 'dm')
  const totalUnread = Object.values(unreadByChannel).reduce((sum, count) => sum + count, 0)

  const handleAddChannel = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newChannelName.trim()
    if (!name) return
    onAddChannel(name)
    setNewChannelName('')
    setShowAddChannel(false)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="workspace-name">
          <span className="workspace-icon">⚡</span>
          <span>{workspace}</span>
        </div>
        <button className="btn-icon" onClick={onLeave} title="Leave workspace">
          ⏻
        </button>
      </div>

      <nav className="sidebar-section">
        <div className="sidebar-section-header">
          <h3>
            Channels
            {totalUnread > 0 && (
              <span className="section-unread-total" data-testid="total-unread">
                {totalUnread}
              </span>
            )}
          </h3>
          <button
            type="button"
            className="btn-add-channel"
            onClick={() => setShowAddChannel(value => !value)}
            title="Add a channel"
            data-testid="add-channel-toggle"
          >
            +
          </button>
        </div>
        <ul className="channel-list">
          {publicChannels.map(channel => (
            <ChannelButton
              key={channel.id}
              channel={channel}
              label={channel.name}
              prefix={<span className="channel-hash">#</span>}
              active={activeView === 'channel' && activeChannel === channel.id}
              unread={unreadByChannel[channel.id] ?? 0}
              onSelect={() => onChannelSelect(channel.id)}
            />
          ))}
        </ul>
        {showAddChannel && (
          <form className="add-channel-form" onSubmit={handleAddChannel}>
            <input
              type="text"
              placeholder="e.g. random"
              value={newChannelName}
              onChange={e => setNewChannelName(e.target.value)}
              autoFocus
              data-testid="add-channel-input"
            />
            <button type="submit" data-testid="add-channel-submit">
              Add
            </button>
          </form>
        )}
      </nav>

      {dmChannels.length > 0 && (
        <nav className="sidebar-section">
          <h3>Direct messages</h3>
          <ul className="channel-list">
            {dmChannels.map(channel => {
              const peer = peers.find(entry => entry.id === channel.peerId)
              return (
                <ChannelButton
                  key={channel.id}
                  channel={channel}
                  label={peer?.name ?? channel.name}
                  prefix={
                    <Avatar
                      name={peer?.name ?? channel.name}
                      color={peer?.color ?? '#ababad'}
                      avatar={peer?.avatar}
                    />
                  }
                  active={activeView === 'channel' && activeChannel === channel.id}
                  unread={unreadByChannel[channel.id] ?? 0}
                  onSelect={() => onChannelSelect(channel.id)}
                />
              )
            })}
          </ul>
        </nav>
      )}

      <nav className="sidebar-section">
        <h3>You</h3>
        <ul className="channel-list">
          <li>
            <button
              className={`channel-item profile-nav ${activeView === 'profile' ? 'active' : ''}`}
              onClick={onProfileSelect}
              data-testid="nav-profile"
            >
              <Avatar name={selfProfile.name} color={selfProfile.color} avatar={selfProfile.avatar} />
              <span>Profile</span>
            </button>
          </li>
        </ul>
      </nav>

      <div className="sidebar-section members-section">
        <h3>Online — {peers.length + 1}</h3>
        <ul className="member-list" data-testid="member-list">
          <li className="member-item" data-testid="member-self">
            <Avatar name={selfProfile.name} color={selfProfile.color} avatar={selfProfile.avatar} />
            <span className="member-name">{selfProfile.name}</span>
            <span className="member-you">you</span>
          </li>
          {peers.map(peer => (
            <li
              key={peer.id}
              className="member-item"
              data-testid={`member-${peer.name}`}
              data-peer-color={peer.color}
            >
              <Avatar name={peer.name} color={peer.color} avatar={peer.avatar} />
              <span className="member-name">{peer.name}</span>
              <button
                type="button"
                className="btn-member-message"
                title={`Message ${peer.name}`}
                data-testid={`message-peer-${peer.name}`}
                onClick={() => onStartDirectMessage(peer)}
              >
                💬
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-footer">
        <ConnectionStatusLabel
          relayOnline={relayOnline}
          connectionStatus={connectionStatus}
          rtcPeerCount={rtcPeerCount}
          testId="connection-status"
        />
        <span className="debug-info">Room: {roomId}</span>
        <span className="debug-info">
          {relayUrls.length > 0
            ? `Signaling: ${relayUrls.length} endpoint${relayUrls.length === 1 ? '' : 's'}`
            : 'Signaling: connecting…'}
        </span>
        <span className="p2p-badge">P2P · E2E encrypted</span>
        <span className="debug-info app-version" data-testid="app-version">
          {appBuildLabel()}
        </span>
        {inviteLink && (
          <button
            type="button"
            className="btn-copy-invite"
            data-testid="copy-invite"
            onClick={() => void navigator.clipboard.writeText(inviteLink)}
            title="Copy invite link"
          >
            Copy invite link
          </button>
        )}
      </div>
    </aside>
  )
}