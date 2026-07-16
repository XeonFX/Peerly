import { useEffect, useRef, useState } from 'react'
import type { Peer } from '../types'
import { getPeerColor } from '../config'
import { safeColor } from '../utils/profileSanitize'
import { isProbablyNsfwElement } from '../collab/nsfwGate'

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
  const [flagged, setFlagged] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const flaggedRef = useRef(false)
  flaggedRef.current = flagged

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  useEffect(() => {
    if (muted) return
    let cancelled = false
    let running = false
    const check = async () => {
      const video = videoRef.current
      if (
        cancelled ||
        flaggedRef.current ||
        running ||
        !video ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        document.visibilityState !== 'visible' ||
        video.offsetParent === null
      ) {
        return
      }
      running = true
      try {
        if (await isProbablyNsfwElement(video)) setFlagged(true)
      } finally {
        running = false
      }
    }
    const first = window.setTimeout(() => void check(), 1_000)
    const interval = window.setInterval(() => void check(), 3_000)
    return () => {
      cancelled = true
      window.clearTimeout(first)
      window.clearInterval(interval)
    }
  }, [muted, stream])

  const hasVideo = stream.getVideoTracks().some(t => t.enabled)

  const hidden = flagged && !revealed

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-base-300">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`h-full w-full object-cover transition duration-200 ${hidden ? 'scale-110 blur-2xl' : ''}`}
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
      {hidden && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/55 p-3 text-center text-white">
          <span aria-hidden="true">🛡️</span>
          <strong className="text-xs">Sensitive video hidden</strong>
          <button
            type="button"
            className="btn btn-xs border-white/30 bg-white/15 text-white hover:bg-white/25"
            onClick={() => setRevealed(true)}
          >
            Reveal stream
          </button>
        </div>
      )}
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
