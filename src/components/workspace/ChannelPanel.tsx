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
}

export function ChannelPanel({ channel, workspaceProtected, onToggleFiles, showFiles }: Props) {
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
      <header className="channel-header">
        <div className="channel-info">
          <h2>
            {channel.kind === 'dm' ? (
              <>
                <Avatar
                  name={title}
                  color={dmPeer?.color ?? '#ababad'}
                  avatar={dmAvatar}
                  size="md"
                />
                <span className="dm-title">{title}</span>
              </>
            ) : (
              <>
                <span className="channel-hash">#</span>
                {channel.name}
              </>
            )}
          </h2>
          {channel.description ? <p>{channel.description}</p> : null}
        </div>
        <div className="channel-actions">
          <button
            className={`btn-action ${inCall ? 'active' : ''}`}
            onClick={inCall ? endCall : startCall}
            data-testid="video-call-button"
          >
            {inCall ? '📞 In call' : '📹 Start video call'}
          </button>
          <button
            className={`btn-action ${showFiles ? 'active' : ''}`}
            onClick={onToggleFiles}
          >
            📁 Files
          </button>
        </div>
      </header>

      {workspaceProtected && (
        <div className="info-banner">🔒 Invite-only workspace — verified identities</div>
      )}

      {connectionNotice && (
        <div className="info-banner" data-testid="info-banner">
          {connectionNotice}
        </div>
      )}

      {connectionError && (
        <div className="error-banner" data-testid="error-banner">
          {connectionError}
        </div>
      )}

      {fileError && (
        <div className="error-banner" data-testid="file-error">
          {fileError}
        </div>
      )}

      {mediaError && <div className="error-banner">{mediaError}</div>}

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