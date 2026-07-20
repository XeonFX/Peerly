import { useEffect, useMemo, useRef, useState } from 'react'
import { useSpeakingStreams } from '@peerly/core/react'
import type { Peer } from '../types'
import { getPeerColor } from '../config'
import { safeColor } from '../utils/profileSanitize'
import {
  applyNsfwScanResult,
  INITIAL_NSFW_SCAN_STATE,
  isProbablyNsfwElement,
  type NsfwScreenScanState,
  videoScreeningDelay,
} from '../collab/nsfwGate'
import {
  applyAudioOutput,
  audioOutputSelectionSupported,
  AUDIO_OUTPUT_CHANGED_EVENT,
} from '../collab/deviceSelection'
import type { CallMediaMode } from '../context/collabTypes'
import { Icon } from './Icon'
import { useI18n } from '../i18n'

type Props = {
  callMode: CallMediaMode
  localStream: MediaStream | null
  peerStreams: Record<string, MediaStream>
  peers: Peer[]
  selfName: string
  videoEnabled: boolean
  audioEnabled: boolean
  screenSharing: boolean
  audioInputs: MediaDeviceInfo[]
  videoInputs: MediaDeviceInfo[]
  audioOutputs: MediaDeviceInfo[]
  selectedAudioInput: string
  selectedVideoInput: string
  selectedAudioOutput: string
  onToggleVideo: () => void
  onToggleAudio: () => void
  onEnableCamera: () => Promise<void>
  onStartScreenShare: () => Promise<void>
  onStopScreenShare: () => void
  onSwitchDevices: (audioId: string, videoId: string) => Promise<void>
  onSetAudioOutput: (deviceId: string) => void
  onEnd: () => void
}

function VideoTile({
  stream,
  label,
  muted = false,
  color,
  audioOutputId,
  speaking = false,
}: {
  stream: MediaStream
  label: string
  muted?: boolean
  color?: string
  audioOutputId: string
  speaking?: boolean
}) {
  const { tr } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [flagged, setFlagged] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const hasVideo = stream.getVideoTracks().some(t => t.enabled)
  const hasAudio = stream.getAudioTracks().length > 0

  useEffect(() => {
    // Keyed on hasVideo too: turning the camera off unmounts the <video> and
    // turning it back on mounts a fresh element with no srcObject. The stream
    // reference is unchanged, so a [stream]-only effect never re-attaches it
    // and the re-enabled camera showed an empty gray tile forever.
    if (hasVideo && videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream, hasVideo])

  // Audio-only (or camera-off) peers still need a media element for remote audio.
  // Local tile is muted so we never echo ourselves.
  useEffect(() => {
    if (muted || !hasAudio) return
    const el = hasVideo ? videoRef.current : audioRef.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    void applyAudioOutput(el, audioOutputId)
  }, [stream, hasVideo, hasAudio, muted, audioOutputId])

  useEffect(() => {
    if (muted) return
    const onOutput = () => {
      const el = hasVideo ? videoRef.current : audioRef.current
      void applyAudioOutput(el, audioOutputId)
    }
    window.addEventListener(AUDIO_OUTPUT_CHANGED_EVENT, onOutput)
    return () => window.removeEventListener(AUDIO_OUTPUT_CHANGED_EVENT, onOutput)
  }, [muted, hasVideo, audioOutputId])

  useEffect(() => {
    if (muted || !hasVideo) return
    let cancelled = false
    let running = false
    let timer: number | undefined
    // Same streak policy as HeyHubs: flag on first NSFW hit, auto-clear after
    // consecutive clean frames; back off while long-clean.
    let scan: NsfwScreenScanState = INITIAL_NSFW_SCAN_STATE
    let cleanRuns = 0
    const schedule = (delay: number) => {
      if (cancelled) return
      timer = window.setTimeout(() => void check(), delay)
    }
    const check = async () => {
      const video = videoRef.current
      if (cancelled) return
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
        const isNsfw = await isProbablyNsfwElement(video)
        scan = applyNsfwScanResult(scan, isNsfw)
        setFlagged(scan.flagged)
        if (!scan.flagged) cleanRuns = isNsfw ? 0 : cleanRuns + 1
        else cleanRuns = 0
      } finally {
        running = false
      }
      schedule(videoScreeningDelay(cleanRuns))
    }
    schedule(videoScreeningDelay(0))
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [muted, stream, hasVideo])

  const hidden = flagged && !revealed

  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-lg bg-base-300 ring-2 transition ${
        speaking ? 'ring-success' : 'ring-transparent'
      }`}
      data-speaking={speaking ? 'true' : 'false'}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`h-full w-full object-cover transition duration-200 ${hidden ? 'scale-110 blur-2xl' : ''}`}
        />
      ) : (
        <>
          {!muted && hasAudio && (
            <audio ref={audioRef} autoPlay playsInline className="hidden" />
          )}
          <div
            className="flex h-full w-full items-center justify-center text-2xl font-bold text-white"
            style={{ background: safeColor(color, '#333') }}
          >
            <span>{label.charAt(0).toUpperCase()}</span>
          </div>
        </>
      )}
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] text-white">
        {label}
        {muted ? ` (${tr('you')})` : ''}
        {speaking ? ` · ${tr('Speaking')}` : ''}
      </span>
      {hidden && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/55 p-3 text-center text-white">
          <Icon name="shield" size={20} />
          <strong className="text-xs">{tr('Sensitive video hidden')}</strong>
          <button
            type="button"
            className="btn btn-xs border-white/30 bg-white/15 text-white hover:bg-white/25"
            onClick={() => setRevealed(true)}
          >
            {tr('Reveal stream')}
          </button>
        </div>
      )}
    </div>
  )
}

export function VideoCall({
  callMode,
  localStream,
  peerStreams,
  peers,
  selfName,
  videoEnabled,
  audioEnabled,
  screenSharing,
  audioInputs,
  videoInputs,
  audioOutputs,
  selectedAudioInput,
  selectedVideoInput,
  selectedAudioOutput,
  onToggleVideo,
  onToggleAudio,
  onEnableCamera,
  onStartScreenShare,
  onStopScreenShare,
  onSwitchDevices,
  onSetAudioOutput,
  onEnd,
}: Props) {
  const { tr } = useI18n()
  const peerNames = Object.fromEntries(peers.map(p => [p.id, p.name]))
  const outputSupported = audioOutputSelectionSupported()
  const isAudioOnly = callMode === 'audio'
  const showDeviceRow =
    audioInputs.length > 0 ||
    (!isAudioOnly && videoInputs.length > 0) ||
    (outputSupported && audioOutputs.length > 0)

  const speakingStreams = useMemo(() => {
    const map: Record<string, MediaStream | null> = { self: localStream }
    for (const [id, stream] of Object.entries(peerStreams)) map[id] = stream
    return map
  }, [localStream, peerStreams])
  const speaking = useSpeakingStreams(speakingStreams)

  return (
    <div className="video-call-overlay shrink-0 border-b border-base-300/70 bg-base-200/60 p-3 backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {tr(isAudioOnly ? 'Audio call' : 'Video call')}
        </h3>
        <span className="text-xs text-base-content/50">
          {Object.keys(peerStreams).length + (localStream ? 1 : 0)} {tr('participants')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {localStream && (
          <VideoTile
            stream={localStream}
            label={selfName}
            muted
            color="#36c5f0"
            audioOutputId={selectedAudioOutput}
            speaking={!!speaking.self}
          />
        )}
        {Object.entries(peerStreams).map(([peerId, stream]) => (
          <VideoTile
            key={peerId}
            stream={stream}
            label={peerNames[peerId] || peerId.slice(0, 8)}
            color={getPeerColor(peerId)}
            audioOutputId={selectedAudioOutput}
            speaking={!!speaking[peerId]}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        {isAudioOnly ? (
          <button
            className="btn btn-sm btn-circle btn-ghost"
            onClick={() => void onEnableCamera()}
            title={tr('Turn on camera')}
            aria-label={tr('Turn on camera')}
            data-testid="enable-camera-button"
          >
            <Icon name="video" />
          </button>
        ) : (
          <button
            className={`btn btn-sm btn-circle ${videoEnabled ? 'btn-ghost' : 'btn-error'}`}
            onClick={onToggleVideo}
            title={tr(videoEnabled ? 'Turn off camera' : 'Turn on camera')}
            aria-label={tr(videoEnabled ? 'Turn off camera' : 'Turn on camera')}
            aria-pressed={!videoEnabled}
          >
            <Icon name={videoEnabled ? 'video' : 'video-off'} />
          </button>
        )}
        <button
          className={`btn btn-sm btn-circle ${audioEnabled ? 'btn-ghost' : 'btn-error'}`}
          onClick={onToggleAudio}
          title={tr(audioEnabled ? 'Mute' : 'Unmute')}
          aria-label={tr(audioEnabled ? 'Mute microphone' : 'Unmute microphone')}
          aria-pressed={!audioEnabled}
        >
          <Icon name={audioEnabled ? 'mic' : 'mic-off'} />
        </button>
        {!isAudioOnly && (
          <button
            className={`btn btn-sm btn-circle ${screenSharing ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() =>
              screenSharing ? onStopScreenShare() : void onStartScreenShare()
            }
            title={tr(screenSharing ? 'Stop sharing screen' : 'Share screen')}
            aria-label={tr(screenSharing ? 'Stop sharing screen' : 'Share screen')}
            aria-pressed={screenSharing}
            data-testid="screen-share-button"
          >
            <Icon name="screen-share" />
          </button>
        )}
        <button className="btn btn-sm btn-error" onClick={onEnd} data-testid="end-call-button">
          {tr('End call')}
        </button>
      </div>

      {showDeviceRow && (
        <div className="mx-auto mt-3 grid max-w-2xl gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex min-w-0 items-center gap-2 text-xs text-base-content/60">
            <Icon name="mic" size={14} />
            <select
              id="call-audio-input"
              name="audioInputDevice"
              className="select select-bordered select-xs min-w-0 flex-1"
              value={selectedAudioInput}
              disabled={screenSharing}
              aria-label={tr('Microphone')}
              data-testid="call-audio-input"
              onChange={event =>
                void onSwitchDevices(event.target.value, selectedVideoInput)
              }
            >
              <option value="">{tr('Default')}</option>
              {audioInputs.map((device, index) => (
                <option key={device.deviceId || `ain-${index}`} value={device.deviceId}>
                  {device.label || `${tr('Microphone')} ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          {!isAudioOnly && (
            <label className="flex min-w-0 items-center gap-2 text-xs text-base-content/60">
              <Icon name="video" size={14} />
              <select
                id="call-video-input"
                name="videoInputDevice"
                className="select select-bordered select-xs min-w-0 flex-1"
                value={selectedVideoInput}
                disabled={screenSharing}
                aria-label={tr('Camera')}
                data-testid="call-video-input"
                onChange={event =>
                  void onSwitchDevices(selectedAudioInput, event.target.value)
                }
              >
                <option value="">{tr('Default')}</option>
                {videoInputs.map((device, index) => (
                  <option key={device.deviceId || `vin-${index}`} value={device.deviceId}>
                    {device.label || `${tr('Camera')} ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {outputSupported && (
            <label className="flex min-w-0 items-center gap-2 text-xs text-base-content/60">
              <Icon name="music" size={14} />
              <select
                id="call-audio-output"
                name="audioOutputDevice"
                className="select select-bordered select-xs min-w-0 flex-1"
                value={selectedAudioOutput}
                aria-label={tr('Speakers')}
                data-testid="call-audio-output"
                onChange={event => onSetAudioOutput(event.target.value)}
              >
                <option value="">{tr('Default')}</option>
                {audioOutputs.map((device, index) => (
                  <option key={device.deviceId || `aout-${index}`} value={device.deviceId}>
                    {device.label || `${tr('Speakers')} ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
