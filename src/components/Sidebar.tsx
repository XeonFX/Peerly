import { useState } from 'react'
import { appBuildLabel, WORKSPACE_COLOR } from '../config'
import type { Channel, ConnectionStatus, P2pCapability, Peer, UserProfile } from '../types'
import { Avatar } from './Avatar'
import { ConnectionStatus as ConnectionStatusLabel } from './ConnectionStatus'
import { InvitePeople } from './InvitePeople'
import { ThemeToggle } from './ThemeToggle'
import { P2pCapabilityIndicator } from './P2pCapabilityIndicator'
import { Icon } from './Icon'
import { LegalLinks } from './LegalLinks'
import { useI18n } from '../i18n'
import { useRelayDiagnostics } from '../hooks/useRelayDiagnostics'

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
  onRemoveMember?: (email: string) => Promise<void>
  selfEmail?: string
  resolvePeerContact?: (
    peerId: string
  ) => { userId: string; email: string; name: string } | undefined
  isFriend?: (userId: string | undefined) => boolean
  onAddFriend?: (subject: { userId: string; name: string; email: string }) => Promise<void>
  inviteableFriends?: (
    alreadyInvited: readonly string[]
  ) => Array<{ subjectUserId: string; subjectName: string; subjectEmail?: string }>
  channels: Channel[]
  activeChannel: string
  activeView: 'channel' | 'profile' | 'workspace'
  peers: Peer[]
  selfProfile: UserProfile
  connectionStatus: ConnectionStatus
  relayOnline: boolean
  rtcPeerCount: number
  p2pCapability: P2pCapability
  connectionError: string | null
  relayUrls: string[]
  onChannelSelect: (id: string) => void
  onAddChannel: (name: string) => void
  onRenameChannel: (channelId: string, name: string) => void
  onDeleteChannel: (channelId: string) => void
  onMoveChannel: (channelId: string, direction: -1 | 1) => void
  onCloseDirectMessage: (channelId: string) => void
  onStartDirectMessage: (peer: Peer) => void
  onProfileSelect: () => void
  onWorkspaceSettings: () => void
  unreadByChannel: Record<string, number>
}

function ChannelButton({
  channel,
  label,
  prefix,
  active,
  unread,
  onSelect,
  actions,
}: {
  channel: Channel
  label: string
  prefix?: React.ReactNode
  active: boolean
  unread: number
  onSelect: () => void
  actions?: React.ReactNode
}) {
  return (
    <li className="group flex items-center gap-0.5">
      <button
        className={`channel-item flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
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
      {actions && (
        <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </span>
      )}
    </li>
  )
}

export function Sidebar({
  workspace,
  workspaceAvatar,
  open,
  inviteLink,
  invitedEmails = [],
  canInvite,
  onInvite,
  onRemoveMember,
  selfEmail,
  channels,
  activeChannel,
  activeView,
  peers,
  selfProfile,
  connectionStatus,
  relayOnline,
  rtcPeerCount,
  p2pCapability,
  connectionError,
  relayUrls,
  onChannelSelect,
  onAddChannel,
  onRenameChannel,
  onDeleteChannel,
  onMoveChannel,
  onCloseDirectMessage,
  onStartDirectMessage,
  onProfileSelect,
  onWorkspaceSettings,
  unreadByChannel,
  resolvePeerContact,
  isFriend,
  onAddFriend,
  inviteableFriends,
}: Props) {
  const { tr } = useI18n()
  const relayDiagnostics = useRelayDiagnostics()
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
          title={tr('Workspace settings')}
          data-testid="workspace-settings-open"
        >
          <Avatar name={workspace} color={WORKSPACE_COLOR} avatar={workspaceAvatar} size="md" />
          <span className="truncate">{workspace}</span>
        </button>
        <div className="flex shrink-0 items-center">
          <ThemeToggle compact />
        </div>
      </div>

      <nav className="mt-3">
        <div className="flex items-center justify-between px-3 pb-1">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-base-content/60">
            {tr('Channels')}
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
            title={tr('Add a channel')}
            aria-label={tr('Add a channel')}
            data-testid="add-channel-toggle"
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
        <ul className="space-y-0.5 px-2">
          {publicChannels.map((channel, index) => (
            <ChannelButton
              key={channel.id}
              channel={channel}
              label={channel.name}
              prefix={<Icon name="hash" size={14} className="channel-hash" />}
              active={activeView === 'channel' && activeChannel === channel.id}
              unread={unreadByChannel[channel.id] ?? 0}
              onSelect={() => onChannelSelect(channel.id)}
              actions={
                channel.id === 'general' ? undefined : (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      title={tr('Move channel up')}
                      aria-label={tr('Move {channel} up', { channel: channel.name })}
                      disabled={index <= 1}
                      onClick={() => onMoveChannel(channel.id, -1)}
                    >
                      <Icon name="arrow-up" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      title={tr('Move channel down')}
                      aria-label={tr('Move {channel} down', { channel: channel.name })}
                      disabled={index === publicChannels.length - 1}
                      onClick={() => onMoveChannel(channel.id, 1)}
                    >
                      <Icon name="arrow-down" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      title={tr('Rename channel')}
                      aria-label={tr('Rename {channel}', { channel: channel.name })}
                      onClick={() => {
                        const name = window.prompt(tr('Channel name'), channel.name)?.trim()
                        if (name) onRenameChannel(channel.id, name)
                      }}
                    >
                      <Icon name="pencil" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square text-error"
                      title={tr('Delete channel')}
                      aria-label={tr('Delete {channel}', { channel: channel.name })}
                      onClick={() => {
                        if (window.confirm(tr('Delete #{channel} from this workspace?', { channel: channel.name }))) {
                          onDeleteChannel(channel.id)
                        }
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </>
                )
              }
            />
          ))}
        </ul>
        {showAddChannel && (
          <form className="flex gap-1.5 px-3 pt-2" onSubmit={handleAddChannel}>
            <input
              id="new-channel-name"
              name="newChannelName"
              type="text"
              className="input input-bordered input-xs w-full min-w-0 flex-1"
              placeholder={tr('e.g. random')}
              value={newChannelName}
              onChange={e => setNewChannelName(e.target.value)}
              autoFocus
              data-testid="add-channel-input"
            />
            <button type="submit" className="btn btn-primary btn-xs" data-testid="add-channel-submit">
              {tr('Add')}
            </button>
          </form>
        )}
      </nav>

      {dmChannels.length > 0 && (
        <nav className="mt-4">
          <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-base-content/60">
            {tr('Direct messages')}
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
                  actions={
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      title={tr('Close direct message')}
                      aria-label={tr('Close direct message with {name}', { name: peer?.name ?? channel.name })}
                      onClick={() => onCloseDirectMessage(channel.id)}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  }
                />
              )
            })}
          </ul>
        </nav>
      )}

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-base-content/60">
          {tr('Online')} — {peers.length + 1}
        </h3>
        <ul data-testid="member-list">
          <li className="px-2">
            <button
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm transition-colors ${
                activeView === 'profile'
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'hover:bg-base-content/5'
              }`}
              onClick={onProfileSelect}
              aria-label={tr('Open your profile')}
              data-testid="member-self"
            >
              <Avatar
                name={selfProfile.name}
                color={selfProfile.color}
                avatar={selfProfile.avatar}
              />
              <span className="min-w-0 flex-1 truncate">{selfProfile.name}</span>
              <span className="shrink-0 text-xs text-base-content/55">{tr('you')}</span>
            </button>
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
              {(() => {
                const contact = resolvePeerContact?.(peer.id)
                const friendAlready = contact ? isFriend?.(contact.userId) : false
                return (
                  <>
                    {contact && onAddFriend && !friendAlready && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-square shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        title={tr('Add friend')}
                        aria-label={tr('Add {name} as friend', { name: peer.name })}
                        data-testid={`add-friend-${peer.name}`}
                        onClick={() =>
                          void onAddFriend({
                            userId: contact.userId,
                            name: contact.name || peer.name,
                            email: contact.email,
                          })
                        }
                      >
                        <Icon name="plus" size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      title={tr('Message {name}', { name: peer.name })}
                      aria-label={tr('Message {name}', { name: peer.name })}
                      data-testid={`message-peer-${peer.name}`}
                      onClick={() => onStartDirectMessage(peer)}
                    >
                      <Icon name="message-circle" size={15} />
                    </button>
                  </>
                )
              })()}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto shrink-0 space-y-2 border-t border-base-300/70 p-3">
        {inviteLink && (
          <InvitePeople
            inviteLink={inviteLink}
            invitedEmails={invitedEmails}
            onRemove={onRemoveMember}
            selfEmail={selfEmail}
            canInvite={canInvite}
            onInvite={onInvite}
            inviteableFriends={inviteableFriends?.(invitedEmails ?? []) ?? []}
          />
        )}

        <P2pCapabilityIndicator
          capability={p2pCapability}
          rtcPeerCount={rtcPeerCount}
          connectionError={connectionError}
          compact
        />

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
          <span className="text-[0.65rem] text-base-content/60" data-testid="signaling-info">
            {relayDiagnostics.status === 'done'
              ? tr('{healthy}/{total} signaling endpoints carrying traffic · P2P encrypted', {
                  healthy: relayDiagnostics.results.filter(result => result.ok).length,
                  total: relayDiagnostics.results.length,
                })
              : relayUrls.length > 0
                ? tr(
                    relayUrls.length === 1
                      ? '{count} signaling endpoint · P2P encrypted'
                      : '{count} signaling endpoints · P2P encrypted',
                    { count: relayUrls.length }
                  )
                : `${tr('Connecting to signaling')}…`}
          </span>
          <span
            className="font-mono text-[0.65rem] text-base-content/50"
            data-testid="app-version"
          >
            {appBuildLabel()}
          </span>
          <LegalLinks />
        </div>
      </div>
    </aside>
  )
}
