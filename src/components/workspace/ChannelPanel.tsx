import {
  useChatSlice,
  useConnectionSlice,
  useMediaSlice,
  useProfileSlice,
} from '../../context/CollabContext'
import type { Channel } from '../../types'
import { Avatar } from '../Avatar'
import { MessageInput } from '../MessageInput'
import { MessageList } from '../MessageList'
import { VideoCall } from '../VideoCall'

type Props = {
  channel: Channel
  workspaceProtected?: boolean
  onToggleFiles: () => void
  showFiles: boolean
  /** Opens the off-canvas sidebar; only rendered where the sidebar is hidden. */
  onOpenSidebar?: () => void
}

export function ChannelPanel({
  channel,
  workspaceProtected,
  onToggleFiles,
  showFiles,
  onOpenSidebar,
}: Props) {
  const { connectionError, connectionNotice, isReady } = useConnectionSlice()
  const { messages, sendMessage, sendFile, fileError } = useChatSlice()
  const {
    inCall,
    localStream,
    peerStreams,
    videoEnabled,
    audioEnabled,
    mediaError,
    startCall,
    endCall,
    toggleVideo,
    toggleAudio,
  } = useMediaSlice()
  const { selfId, profile, peers } = useProfileSlice()
  const dmPeer = channel.kind === 'dm' ? peers.find(peer => peer.id === channel.peerId) : undefined
  const title = dmPeer?.name ?? channel.name
  const dmAvatar = dmPeer?.avatar

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-base-300/70 px-3 py-2.5 sm:px-5">
        {onOpenSidebar && (
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square mr-1 lg:hidden"
            onClick={onOpenSidebar}
            aria-label="Open workspace menu"
            data-testid="open-sidebar"
          >
            ☰
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="flex min-w-0 items-center gap-2 text-base font-bold">
            {channel.kind === 'dm' ? (
              <>
                <Avatar
                  name={title}
                  color={dmPeer?.color ?? '#ababad'}
                  avatar={dmAvatar}
                  size="md"
                />
                <span className="dm-title truncate">{title}</span>
              </>
            ) : (
              <>
                <span className="text-base-content/40" aria-hidden="true">
                  #
                </span>
                <span className="truncate">{channel.name}</span>
              </>
            )}
          </h2>
          {/* Context, not navigation — the first thing to drop on a phone. */}
          {channel.description ? (
            <p className="hidden truncate text-xs text-base-content/45 sm:block">
              {channel.description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className={`btn btn-sm ${inCall ? 'btn-primary' : 'btn-ghost'}`}
            onClick={inCall ? endCall : startCall}
            data-testid="video-call-button"
            aria-label={inCall ? 'End call' : 'Start video call'}
          >
            <span aria-hidden="true">{inCall ? '📞' : '📹'}</span>
            <span className="hidden sm:inline">{inCall ? 'In call' : 'Start video call'}</span>
          </button>
          <button
            className={`btn btn-sm ${showFiles ? 'btn-active' : 'btn-ghost'}`}
            onClick={onToggleFiles}
            aria-label="Toggle shared files"
            aria-pressed={showFiles}
          >
            <span aria-hidden="true">📁</span>
            <span className="hidden sm:inline">Files</span>
          </button>
        </div>
      </header>

      {workspaceProtected && (
        <div className="shrink-0 border-b border-info/20 bg-info/10 px-3 py-1.5 text-xs text-info sm:px-5">
          🔒 Invite-only workspace — verified identities
        </div>
      )}

      {connectionNotice && (
        <div
          className="shrink-0 border-b border-info/20 bg-info/10 px-3 py-1.5 text-xs text-info sm:px-5"
          data-testid="info-banner"
        >
          {connectionNotice}
        </div>
      )}

      {connectionError && (
        <div
          className="shrink-0 border-b border-error/25 bg-error/10 px-3 py-1.5 text-xs text-error sm:px-5"
          data-testid="error-banner"
        >
          {connectionError}
        </div>
      )}

      {fileError && (
        <div
          className="shrink-0 border-b border-error/25 bg-error/10 px-3 py-1.5 text-xs text-error sm:px-5"
          data-testid="file-error"
        >
          {fileError}
        </div>
      )}

      {mediaError && (
        <div className="shrink-0 border-b border-error/25 bg-error/10 px-3 py-1.5 text-xs text-error sm:px-5">
          {mediaError}
        </div>
      )}

      {inCall && (
        <VideoCall
          localStream={localStream}
          peerStreams={peerStreams}
          peers={peers}
          selfName={profile.name}
          videoEnabled={videoEnabled}
          audioEnabled={audioEnabled}
          onToggleVideo={toggleVideo}
          onToggleAudio={toggleAudio}
          onEnd={endCall}
        />
      )}

      <MessageList
        messages={messages}
        selfId={selfId}
        selfProfile={profile}
        peers={peers}
      />
      <MessageInput
        channelName={title}
        isDirectMessage={channel.kind === 'dm'}
        onSend={sendMessage}
        onFile={sendFile}
        disabled={!isReady}
      />
    </>
  )
}