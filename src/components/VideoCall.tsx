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
    <div className="relative aspect-video overflow-hidden rounded-lg bg-base-300">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-2xl font-bold text-white"
          style={{ background: safeColor(color, '#333') }}
        >
          <span>{label.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] text-white">
        {label}
        {muted ? ' (you)' : ''}
      </span>
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
    <div className="video-call-overlay shrink-0 border-b border-base-300/70 bg-base-200/60 p-3 backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Video call</h3>
        <span className="text-xs text-base-content/50">
          {Object.keys(peerStreams).length + (localStream ? 1 : 0)} participants
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
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

      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          className={`btn btn-sm btn-circle ${videoEnabled ? 'btn-ghost' : 'btn-error'}`}
          onClick={onToggleVideo}
          title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
          aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
          aria-pressed={!videoEnabled}
        >
          <span aria-hidden="true">{videoEnabled ? '📹' : '🚫'}</span>
        </button>
        <button
          className={`btn btn-sm btn-circle ${audioEnabled ? 'btn-ghost' : 'btn-error'}`}
          onClick={onToggleAudio}
          title={audioEnabled ? 'Mute' : 'Unmute'}
          aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={!audioEnabled}
        >
          <span aria-hidden="true">{audioEnabled ? '🎤' : '🔇'}</span>
        </button>
        <button className="btn btn-sm btn-error" onClick={onEnd}>
          End call
        </button>
      </div>
    </div>
  )
}