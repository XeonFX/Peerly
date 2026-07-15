import { useState } from 'react'
import { appBuildLabel } from '../config'
import type { Channel, ConnectionStatus, Peer, UserProfile } from '../types'
import { Avatar } from './Avatar'
import { ConnectionStatus as ConnectionStatusLabel } from './ConnectionStatus'
import { InvitePeople } from './InvitePeople'

type Props = {
  workspace: string
  workspaceAvatar?: string
  /** Drives the off-canvas drawer below `lg`; ignored at desktop widths. */
  open: boolean
  inviteLink?: string
  /** Emails on the signed allow-list for this workspace. */
  invitedEmails?: string[]
  /** Only the creator's device can add members; see WorkspaceAuthManager.canInvite. */
  canInvite: boolean
  onInvite: (emails: string[]) => Promise<void>
  channels: Channel[]
  activeChannel: string
  activeView: 'channel' | 'profile' | 'workspace'
  peers: Peer[]
  selfProfile: UserProfile
  connectionStatus: ConnectionStatus
  relayOnline: boolean
  rtcPeerCount: number
  relayUrls: string[]
  onChannelSelect: (id: string) => void
  onAddChannel: (name: string) => void
  onStartDirectMessage: (peer: Peer) => void
  onProfileSelect: () => void
  onWorkspaceSettings: () => void
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
        className={`channel-item flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
          active
            ? 'bg-accent/15 font-medium text-accent'
            : 'text-base-content/60 hover:bg-base-content/5 hover:text-base-content'
        }`}
        onClick={onSelect}
        data-testid={channel.kind === 'dm' ? `dm-${channel.peerId}` : undefined}
      >
        {prefix}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {unread > 0 && (
          <span
            className="badge badge-sm shrink-0 border-0 bg-primary font-semibold text-primary-content"
            data-testid={`unread-${channel.id}`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </li>
  )
}

const WORKSPACE_COLOR = '#2eb67d'

export function Sidebar({
  workspace,
  workspaceAvatar,
  open,
  inviteLink,
  invitedEmails = [],
  canInvite,
  onInvite,
  channels,
  activeChannel,
  activeView,
  peers,
  selfProfile,
  connectionStatus,
  relayOnline,
  rtcPeerCount,
  relayUrls,
  onChannelSelect,
  onAddChannel,
  onStartDirectMessage,
  onProfileSelect,
  onWorkspaceSettings,
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
    <aside
      className={`sidebar flex w-65 min-w-65 flex-col border-r border-base-300/70 bg-base-200/75 backdrop-blur-xl max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-68 max-lg:min-w-68 max-lg:transition-transform max-lg:duration-200 motion-reduce:max-lg:transition-none ${
        open ? 'max-lg:translate-x-0 max-lg:shadow-2xl' : 'max-lg:-translate-x-full'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 p-3">
        <button
          type="button"
          className="workspace-name flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left font-bold text-base-content transition-colors hover:bg-base-content/5"
          onClick={onWorkspaceSettings}
          title="Workspace settings"
          data-testid="workspace-settings-open"
        >
          <Avatar name={workspace} color={WORKSPACE_COLOR} avatar={workspaceAvatar} size="md" />
          <span className="truncate">{workspace}</span>
        </button>
        <button
          className="btn btn-ghost btn-square btn-sm shrink-0"
          onClick={onLeave}
          title="Switch workspace"
          aria-label="Switch workspace"
          data-testid="leave-workspace"
        >
          ⏻
        </button>
      </div>

      <nav className="mt-3">
        <div className="flex items-center justify-between px-3 pb-1">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-base-content/45">
            Channels
            {totalUnread > 0 && (
              <span
                className="badge badge-xs border-0 bg-primary text-primary-content"
                data-testid="total-unread"
              >
                {totalUnread}
              </span>
            )}
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => setShowAddChannel(value => !value)}
            title="Add a channel"
            aria-label="Add a channel"
            data-testid="add-channel-toggle"
          >
            +
          </button>
        </div>
        <ul className="space-y-0.5 px-2">
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
          <form className="flex gap-1.5 px-3 pt-2" onSubmit={handleAddChannel}>
            <input
              type="text"
              className="input input-bordered input-xs w-full min-w-0 flex-1"
              placeholder="e.g. random"
              value={newChannelName}
              onChange={e => setNewChannelName(e.target.value)}
              autoFocus
              data-testid="add-channel-input"
            />
            <button type="submit" className="btn btn-primary btn-xs" data-testid="add-channel-submit">
              Add
            </button>
          </form>
        )}
      </nav>

      {dmChannels.length > 0 && (
        <nav className="mt-4">
          <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-base-content/45">
            Direct messages
          </h3>
          <ul className="space-y-0.5 px-2">
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

      <nav className="mt-4">
        <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-base-content/45">
          You
        </h3>
        <ul className="px-2">
          <li>
            <button
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                activeView === 'profile'
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-base-content/60 hover:bg-base-content/5 hover:text-base-content'
              }`}
              onClick={onProfileSelect}
              data-testid="nav-profile"
            >
              <Avatar name={selfProfile.name} color={selfProfile.color} avatar={selfProfile.avatar} />
              <span>Profile</span>
            </button>
          </li>
        </ul>
      </nav>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-base-content/45">
          Online — {peers.length + 1}
        </h3>
        <ul data-testid="member-list">
          <li className="flex items-center gap-2 px-3 py-1 text-sm" data-testid="member-self">
            <Avatar name={selfProfile.name} color={selfProfile.color} avatar={selfProfile.avatar} />
            <span className="min-w-0 flex-1 truncate">{selfProfile.name}</span>
            <span className="shrink-0 text-xs text-base-content/35">you</span>
          </li>
          {peers.map(peer => (
            <li
              key={peer.id}
              className="group flex items-center gap-2 px-3 py-1 text-sm"
              data-testid={`member-${peer.name}`}
              data-peer-color={peer.color}
            >
              <Avatar name={peer.name} color={peer.color} avatar={peer.avatar} />
              <span className="min-w-0 flex-1 truncate">{peer.name}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                title={`Message ${peer.name}`}
                aria-label={`Message ${peer.name}`}
                data-testid={`message-peer-${peer.name}`}
                onClick={() => onStartDirectMessage(peer)}
              >
                💬
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto space-y-2 border-t border-base-300/70 p-3">
        {inviteLink && (
          <InvitePeople
            inviteLink={inviteLink}
            invitedEmails={invitedEmails}
            canInvite={canInvite}
            onInvite={onInvite}
          />
        )}

        <div className="flex flex-col gap-1 pt-1">
          <ConnectionStatusLabel
            relayOnline={relayOnline}
            connectionStatus={connectionStatus}
            rtcPeerCount={rtcPeerCount}
            testId="connection-status"
          />
          {/*
            The room id is deliberately NOT shown. It is the workspace id, which
            doubles as the Trystero encryption password — printing it here put
            the workspace secret on screen for anyone screen-sharing, pairing, or
            looking over a shoulder. The signaling endpoint count carries the
            diagnostic value that line actually had.
          */}
          <span className="text-[0.65rem] text-base-content/40" data-testid="signaling-info">
            {relayUrls.length > 0
              ? `${relayUrls.length} signaling endpoint${relayUrls.length === 1 ? '' : 's'} · P2P encrypted`
              : 'Connecting to signaling…'}
          </span>
          <span
            className="font-mono text-[0.65rem] text-base-content/30"
            data-testid="app-version"
          >
            {appBuildLabel()}
          </span>
        </div>
      </div>
    </aside>
  )
}