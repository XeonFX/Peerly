import {
  useChatSlice,
  useConnectionSlice,
  useMediaSlice,
  useProfileSlice,
} from '../../context/useCollabSlices'
import type { Channel } from '../../types'
import { Avatar } from '../Avatar'
import { MessageInput } from '../MessageInput'
import { MessageList } from '../MessageList'
import { VideoCall } from '../VideoCall'
import { SyncStatusBar } from '../SyncStatusBar'
import { Icon } from '../Icon'
import { RELAY_OFFLINE_ERROR } from '../../collab/constants'
import { startIncomingCallRingtone } from '../../collab/attentionSound'
import { useEffect } from 'react'
import { useI18n } from '../../i18n'

type Props = {
  channel: Channel
  onToggleFiles: () => void
  showFiles: boolean
  /** Opens the off-canvas sidebar; only rendered where the sidebar is hidden. */
  onOpenSidebar?: () => void
  /** Opens workspace-wide message search. */
  onOpenSearch: () => void
}

export function ChannelPanel({
  channel,
  onToggleFiles,
  showFiles,
  onOpenSidebar,
  onOpenSearch,
}: Props) {
  const { tr } = useI18n()
  const { connectionError, connectionNotice, isReady } = useConnectionSlice()
  const { messages, transfers, sendMessage, editMessage, deleteMessage, toggleReaction, sendFiles, requestFile, markFileNsfw, syncProgress, fileError, soundsEnabled } = useChatSlice()
  const {
    inCall,
    callMode,
    incomingCallPeerId,
    localStream,
    peerStreams,
    videoEnabled,
    audioEnabled,
    screenSharing,
    audioInputs,
    videoInputs,
    audioOutputs,
    selectedAudioInput,
    selectedVideoInput,
    selectedAudioOutput,
    mediaError,
    startCall,
    joinCall,
    declineCall,
    endCall,
    toggleVideo,
    toggleAudio,
    enableCamera,
    startScreenShare,
    stopScreenShare,
    switchDevices,
    setAudioOutput,
  } = useMediaSlice()
  const { selfId, selfUserId, pastSelfIds, profile, peers } = useProfileSlice()
  const dmPeer = channel.kind === 'dm' ? peers.find(peer => peer.id === channel.peerId) : undefined
  const incomingPeer = peers.find(peer => peer.id === incomingCallPeerId)
  const title = dmPeer?.name ?? channel.name
  const dmAvatar = dmPeer?.avatar
  // Relay health already has a persistent, compact home in the sidebar. Keep
  // the conversation banner for errors that add specific recovery context
  // (TURN, password mismatch, local relay configuration, etc.).
  const visibleConnectionError = connectionError === RELAY_OFFLINE_ERROR ? null : connectionError
  const incomingIsAudio =
    !!incomingCallPeerId &&
    !!peerStreams[incomingCallPeerId] &&
    !peerStreams[incomingCallPeerId]!.getVideoTracks().some(track => track.readyState !== 'ended')

  useEffect(() => {
    if (!soundsEnabled || !incomingCallPeerId || inCall) return
    return startIncomingCallRingtone()
  }, [inCall, incomingCallPeerId, soundsEnabled])

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-base-300/70 px-3 py-2.5 sm:px-5">
        {onOpenSidebar && (
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square mr-1 lg:hidden"
            onClick={onOpenSidebar}
            aria-label={tr('Open workspace menu')}
            data-testid="open-sidebar"
          >
            <Icon name="menu" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2
            className="flex min-w-0 items-center gap-2 text-base font-bold outline-none"
            tabIndex={-1}
            data-view-heading
          >
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
                <Icon name="hash" size={16} className="text-base-content/60" />
                <span className="truncate">{channel.name}</span>
              </>
            )}
          </h2>
          {/* Context, not navigation — the first thing to drop on a phone. */}
          {channel.description ? (
            <p className="hidden truncate text-xs text-base-content/60 sm:block">
              {channel.description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className="btn btn-ghost btn-sm btn-square"
            onClick={onOpenSearch}
            aria-label={tr('Search messages')}
            title={tr('Search messages')}
            data-testid="open-search"
          >
            <Icon name="search" />
          </button>
          {!inCall && (
            <button
              className={`btn btn-sm btn-square ${incomingCallPeerId && incomingIsAudio ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => void (incomingCallPeerId ? joinCall() : startCall('audio'))}
              data-testid="audio-call-button"
              title={tr(
                incomingCallPeerId
                  ? 'Join incoming call'
                  : 'Start audio call'
              )}
              aria-label={tr(
                incomingCallPeerId
                  ? 'Join incoming call'
                  : 'Start audio call'
              )}
            >
              <Icon name="mic" />
            </button>
          )}
          <button
            className={`btn btn-sm ${inCall || (incomingCallPeerId && !incomingIsAudio) ? 'btn-primary' : 'btn-ghost'} ${inCall ? '' : 'btn-square sm:btn-sm'}`}
            onClick={() =>
              inCall ? endCall() : void (incomingCallPeerId ? joinCall() : startCall('video'))
            }
            data-testid="video-call-button"
            title={tr(
              inCall
                ? 'End call'
                : incomingCallPeerId
                  ? 'Join incoming call'
                  : 'Start video call'
            )}
            aria-label={tr(
              inCall
                ? 'End call'
                : incomingCallPeerId
                  ? 'Join incoming call'
                  : 'Start video call'
            )}
          >
            <Icon name={inCall ? 'phone-off' : 'video'} />
            <span className="hidden sm:inline">
              {tr(inCall ? 'In call' : incomingCallPeerId ? 'Join call' : 'Video')}
            </span>
          </button>
          <button
            className={`btn btn-sm ${showFiles ? 'btn-active' : 'btn-ghost'}`}
            onClick={onToggleFiles}
            aria-label={tr('Toggle shared files')}
            aria-pressed={showFiles}
            data-testid="toggle-files"
          >
            <Icon name="folder" />
            <span className="hidden sm:inline">{tr('Files')}</span>
          </button>
        </div>
      </header>

      <SyncStatusBar progress={syncProgress} />

      {connectionNotice && (
        <div
          className="shrink-0 border-b border-info/20 bg-info/10 px-3 py-1.5 text-xs text-info sm:px-5"
          data-testid="info-banner"
        >
          {connectionNotice}
        </div>
      )}

      {visibleConnectionError && (
        <div
          className="shrink-0 border-b border-error/25 bg-error/10 px-3 py-1.5 text-xs text-error sm:px-5"
          data-testid="error-banner"
        >
          {visibleConnectionError}
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

      {incomingCallPeerId && !inCall && (
        <div
          className="flex shrink-0 items-center gap-3 border-b border-primary/25 bg-primary/10 px-3 py-2 text-sm sm:px-5"
          role="status"
          aria-live="assertive"
          data-testid="incoming-call-banner"
        >
          <Icon name={incomingIsAudio ? 'mic' : 'video'} className="text-primary" />
          <span className="min-w-0 flex-1">
            <strong>{incomingPeer?.name ?? tr('A teammate')}</strong>{' '}
            {tr(incomingIsAudio ? 'started an audio call.' : 'started a video call.')}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void joinCall()}>
            {tr('Join')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={declineCall}>
            {tr('Dismiss')}
          </button>
        </div>
      )}

      {inCall && (
        <VideoCall
          callMode={callMode}
          localStream={localStream}
          peerStreams={peerStreams}
          peers={peers}
          selfName={profile.name}
          videoEnabled={videoEnabled}
          audioEnabled={audioEnabled}
          screenSharing={screenSharing}
          audioInputs={audioInputs}
          videoInputs={videoInputs}
          audioOutputs={audioOutputs}
          selectedAudioInput={selectedAudioInput}
          selectedVideoInput={selectedVideoInput}
          selectedAudioOutput={selectedAudioOutput}
          onToggleVideo={toggleVideo}
          onToggleAudio={toggleAudio}
          onEnableCamera={enableCamera}
          onStartScreenShare={startScreenShare}
          onStopScreenShare={stopScreenShare}
          onSwitchDevices={switchDevices}
          onSetAudioOutput={setAudioOutput}
          onEnd={endCall}
        />
      )}

      <MessageList
        messages={messages}
        channelId={channel.id}
        selfId={selfId}
        selfUserId={selfUserId}
        pastSelfIds={pastSelfIds}
        selfProfile={profile}
        peers={peers}
        transfers={transfers}
        onRequestFile={requestFile}
        onNsfwVerdict={markFileNsfw}
        onEditMessage={editMessage}
        onDeleteMessage={deleteMessage}
        onToggleReaction={toggleReaction}
      />
      <MessageInput
        channelName={title}
        isDirectMessage={channel.kind === 'dm'}
        onSend={sendMessage}
        onFiles={sendFiles}
        disabled={!isReady}
      />
    </>
  )
}
