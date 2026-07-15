import { useEffect, useRef } from 'react'
import type { Peer } from '../types'
import { getPeerColor } from '../config'
import { safeColor } from '../utils/profileSanitize'

type Props = {
  localStream: MediaStream | null
  peerStreams: Record<string, MediaStream>
  peers: Peer[]
  selfName: string
  videoEnabled: boolean
  audioEnabled: boolean
  onToggleVideo: () => void
  onToggleAudio: () => void
  onEnd: () => void
}

function VideoTile({
  stream,
  label,
  muted = false,
  color,
}: {
  stream: MediaStream
  label: string
  muted?: boolean
  color?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const hasVideo = stream.getVideoTracks().some(t => t.enabled)

  return (
    <div className="video-tile">
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} />
      ) : (
        <div className="video-placeholder" style={{ background: safeColor(color, '#333') }}>
          <span>{label.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <span className="video-label">{label}{muted ? ' (you)' : ''}</span>
    </div>
  )
}

export function VideoCall({
  localStream,
  peerStreams,
  peers,
  selfName,
  videoEnabled,
  audioEnabled,
  onToggleVideo,
  onToggleAudio,
  onEnd,
}: Props) {
  const peerNames = Object.fromEntries(peers.map(p => [p.id, p.name]))

  return (
    <div className="video-call-overlay">
      <div className="video-call-header">
        <h3>Video call</h3>
        <span className="call-count">{Object.keys(peerStreams).length + (localStream ? 1 : 0)} participants</span>
      </div>

      <div className="video-grid">
        {localStream && (
          <VideoTile
            stream={localStream}
            label={selfName}
            muted
            color="#36c5f0"
          />
        )}
        {Object.entries(peerStreams).map(([peerId, stream]) => (
          <VideoTile
            key={peerId}
            stream={stream}
            label={peerNames[peerId] || peerId.slice(0, 8)}
            color={getPeerColor(peerId)}
          />
        ))}
      </div>

      <div className="video-controls">
        <button
          className={`control-btn ${!videoEnabled ? 'off' : ''}`}
          onClick={onToggleVideo}
          title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
        >
          {videoEnabled ? '📹' : '🚫📹'}
        </button>
        <button
          className={`control-btn ${!audioEnabled ? 'off' : ''}`}
          onClick={onToggleAudio}
          title={audioEnabled ? 'Mute' : 'Unmute'}
        >
          {audioEnabled ? '🎤' : '🔇'}
        </button>
        <button className="control-btn end-call" onClick={onEnd}>
          End call
        </button>
      </div>
    </div>
  )
}