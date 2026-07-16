import { useEffect, useRef, useState } from 'react'
import type { Peer } from '../types'
import { getPeerColor } from '../config'
import { safeColor } from '../utils/profileSanitize'
import { isProbablyNsfwElement } from '../collab/nsfwGate'
import { Icon } from './Icon'
import { videoScreeningDelay } from '../collab/videoScreening'

type Props = {
  localStream: MediaStream | null
  peerStreams: Record<string, MediaStream>
  peers: Peer[]
  selfName: string
  videoEnabled: boolean
  audioEnabled: boolean
  screenSharing: boolean
  audioInputs: MediaDeviceInfo[]
  videoInputs: MediaDeviceInfo[]
  selectedAudioInput: string
  selectedVideoInput: string
  onToggleVideo: () => void
  onToggleAudio: () => void
  onStartScreenShare: () => Promise<void>
  onStopScreenShare: () => void
  onSwitchDevices: (audioId: string, videoId: string) => Promise<void>
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
    let timer: number | undefined
    // Back off after repeatedly-clean frames: a feed that has been fine for a
    // while rarely flips, and per-tile inference every 3s for a whole call was
    // the app's largest sustained main-thread cost. Any flag stops the loop
    // (flags are sticky until the user reveals).
    let cleanRuns = 0
    const schedule = (delay: number) => {
      if (cancelled || flaggedRef.current) return
      timer = window.setTimeout(() => void check(), delay)
    }
    const check = async () => {
      const video = videoRef.current
      if (cancelled || flaggedRef.current) return
      if (
        running ||
        !video ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        document.visibilityState !== 'visible' ||
        video.offsetParent === null
      ) {
        schedule(videoScreeningDelay(cleanRuns))
        return
      }
      running = true
      try {
        if (await isProbablyNsfwElement(video)) {
          setFlagged(true)
          return
        }
        cleanRuns++
      } finally {
        running = false
      }
      schedule(videoScreeningDelay(cleanRuns))
    }
    schedule(1_000)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
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
          <Icon name="shield" size={20} />
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
  screenSharing,
  audioInputs,
  videoInputs,
  selectedAudioInput,
  selectedVideoInput,
  onToggleVideo,
  onToggleAudio,
  onStartScreenShare,
  onStopScreenShare,
  onSwitchDevices,
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
          <Icon name={videoEnabled ? 'video' : 'video-off'} />
        </button>
        <button
          className={`btn btn-sm btn-circle ${audioEnabled ? 'btn-ghost' : 'btn-error'}`}
          onClick={onToggleAudio}
          title={audioEnabled ? 'Mute' : 'Unmute'}
          aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={!audioEnabled}
        >
          <Icon name={audioEnabled ? 'mic' : 'mic-off'} />
        </button>
        <button
          className={`btn btn-sm btn-circle ${screenSharing ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() =>
            screenSharing ? onStopScreenShare() : void onStartScreenShare()
          }
          title={screenSharing ? 'Stop sharing screen' : 'Share screen'}
          aria-label={screenSharing ? 'Stop sharing screen' : 'Share screen'}
          aria-pressed={screenSharing}
          data-testid="screen-share-button"
        >
          <Icon name="screen-share" />
        </button>
        <button className="btn btn-sm btn-error" onClick={onEnd}>
          End call
        </button>
      </div>

      {(audioInputs.length > 1 || videoInputs.length > 1) && (
        <div className="mx-auto mt-3 grid max-w-2xl gap-2 sm:grid-cols-2">
          <label className="flex min-w-0 items-center gap-2 text-xs text-base-content/60">
            <Icon name="mic" size={14} />
            <select
              className="select select-bordered select-xs min-w-0 flex-1"
              value={selectedAudioInput}
              disabled={screenSharing}
              aria-label="Microphone"
              onChange={event =>
                void onSwitchDevices(event.target.value, selectedVideoInput)
              }
            >
              {audioInputs.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 items-center gap-2 text-xs text-base-content/60">
            <Icon name="video" size={14} />
            <select
              className="select select-bordered select-xs min-w-0 flex-1"
              value={selectedVideoInput}
              disabled={screenSharing}
              aria-label="Camera"
              onChange={event =>
                void onSwitchDevices(selectedAudioInput, event.target.value)
              }
            >
              {videoInputs.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
