import type { Room } from './joinRoom.js'

/**
 * Progressive media over a Trystero room: a client is in the conversation
 * with NO media by default, opts into audio (`enableMic`), and upgrades to
 * video (`enableCamera`) — the inverse of a classic call that grabs
 * camera+mic up front. Text-first apps get "muted unless you choose otherwise";
 * call-first apps can simply call both enables at start.
 *
 * Derived from Peerly's battle-tested useVideoCall, generalized:
 * - Upgrades/downgrades swap the whole local stream (Peerly's switchDevices
 *   pattern) — remote sides key streams by peerId, so a swap replaces their
 *   tile seamlessly.
 * - `disableCamera` STOPS the video track (camera light off) instead of
 *   muting it; `setMicMuted` only flips track.enabled (instant, standard).
 * - Stream ids of media WE dropped go into a stale set: removing a stream
 *   fires no remote event, and its re-announce on renegotiation must not be
 *   mistaken for new media. Apps should also send an explicit "media ended"
 *   action (see Peerly's call-end) and route it to `handlePeerMediaEnd`.
 * - Optional preferred audio/video input deviceIds (ideal constraints) for
 *   multi-device pickers in host apps.
 */

export type RoomMediaDeviceIds = {
  audioId?: string
  videoId?: string
}

export type RoomMediaState = {
  localStream: MediaStream | null
  micOn: boolean
  micMuted: boolean
  cameraOn: boolean
  peerStreams: Record<string, MediaStream>
  mediaError: string | null
  /** Last preferred audio input deviceId (empty = browser default). */
  selectedAudioInput: string
  /** Last preferred video input deviceId (empty = browser default). */
  selectedVideoInput: string
}

export type RoomMediaController = {
  getState: () => RoomMediaState
  enableMic: () => Promise<void>
  disableMic: () => void
  setMicMuted: (muted: boolean) => void
  enableCamera: () => Promise<void>
  disableCamera: () => Promise<void>
  /**
   * Prefer a microphone for subsequent acquires. If mic is already on,
   * re-acquires with the current camera mode and swaps the local stream.
   */
  switchAudioInput: (deviceId: string) => Promise<void>
  /**
   * Prefer a camera for subsequent acquires. If camera is already on,
   * re-acquires with video and swaps the local stream.
   */
  switchVideoInput: (deviceId: string) => Promise<void>
  /** Stop and remove all local media (used on leave; also runs on dispose). */
  stopMedia: () => void
  /** Wire to the room's onPeerStream. */
  handlePeerStream: (stream: MediaStream, peerId: string) => void
  /** Wire to the room's onPeerLeave. */
  handlePeerLeave: (peerId: string) => void
  /** Route the app's explicit "peer ended media" signal here. */
  handlePeerMediaEnd: (peerId: string) => void
  dispose: () => void
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => track.stop())
}

function audioConstraint(audioId: string): boolean | MediaTrackConstraints {
  if (!audioId) return true
  return { deviceId: { ideal: audioId } }
}

function videoConstraint(video: boolean, videoId: string): boolean | MediaTrackConstraints {
  if (!video) return false
  if (!videoId) return true
  return { deviceId: { ideal: videoId } }
}

/**
 * Framework-free controller; `@peerly/core/react` wraps it as useRoomMedia.
 * `onChange` fires after every state transition with a fresh snapshot.
 * `initialDevices` seeds preferred input deviceIds (e.g. from localStorage).
 */
export function createRoomMedia(
  room: Room,
  onChange: (state: RoomMediaState) => void,
  initialDevices?: RoomMediaDeviceIds
): RoomMediaController {
  let localStream: MediaStream | null = null
  let micMuted = false
  let cameraOn = false
  let mediaError: string | null = null
  let peerStreams: Record<string, MediaStream> = {}
  let selectedAudioInput = initialDevices?.audioId?.trim() ?? ''
  let selectedVideoInput = initialDevices?.videoId?.trim() ?? ''
  const staleStreamIds = new Set<string>()
  let disposed = false

  const snapshot = (): RoomMediaState => ({
    localStream,
    micOn: localStream !== null,
    micMuted,
    cameraOn,
    peerStreams,
    mediaError,
    selectedAudioInput,
    selectedVideoInput,
  })
  const emit = () => {
    if (!disposed) onChange(snapshot())
  }

  /** Swap the outgoing stream; peers replace by peerId, so this is seamless. */
  const swapLocalStream = (next: MediaStream | null) => {
    const previous = localStream
    if (previous) {
      staleStreamIds.add(previous.id)
      room.removeStream(previous)
      stopStream(previous)
    }
    localStream = next
    if (next) {
      next.getAudioTracks().forEach(track => {
        track.enabled = !micMuted
      })
      room.addStream(next)
    }
  }

  const acquire = async (video: boolean): Promise<MediaStream | null> => {
    mediaError = null
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint(selectedAudioInput),
        video: videoConstraint(video, selectedVideoInput),
      })
    } catch (err) {
      console.error('Media acquisition failed:', err)
      mediaError = 'media-denied'
      return null
    }
  }

  const reacquireCurrent = async () => {
    if (!localStream) return
    const stream = await acquire(cameraOn)
    if (disposed) {
      stopStream(stream)
      return
    }
    if (stream) swapLocalStream(stream)
    emit()
  }

  const enableMic = async () => {
    if (localStream) {
      micMuted = false
      localStream.getAudioTracks().forEach(track => {
        track.enabled = true
      })
      emit()
      return
    }
    const stream = await acquire(false)
    if (disposed) {
      stopStream(stream)
      return
    }
    if (stream) {
      micMuted = false
      swapLocalStream(stream)
    }
    emit()
  }

  const disableMic = () => {
    // Camera off too? Then no reason to keep any live capture running.
    if (!cameraOn) {
      swapLocalStream(null)
    } else {
      micMuted = true
      localStream?.getAudioTracks().forEach(track => {
        track.enabled = false
      })
    }
    emit()
  }

  const setMicMuted = (muted: boolean) => {
    micMuted = muted
    localStream?.getAudioTracks().forEach(track => {
      track.enabled = !muted
    })
    emit()
  }

  const enableCamera = async () => {
    if (cameraOn) return
    const stream = await acquire(true)
    if (disposed) {
      stopStream(stream)
      return
    }
    if (stream) {
      cameraOn = true
      swapLocalStream(stream)
    }
    emit()
  }

  const disableCamera = async () => {
    if (!cameraOn) return
    cameraOn = false
    // Fresh audio-only capture rather than a muted video track: the camera
    // light must actually turn off when the user turns the camera off.
    const stream = await acquire(false)
    if (disposed) {
      stopStream(stream)
      return
    }
    swapLocalStream(stream)
    emit()
  }

  const switchAudioInput = async (deviceId: string) => {
    selectedAudioInput = deviceId.trim()
    await reacquireCurrent()
    emit()
  }

  const switchVideoInput = async (deviceId: string) => {
    selectedVideoInput = deviceId.trim()
    if (cameraOn) await reacquireCurrent()
    else emit()
  }

  const stopMedia = () => {
    cameraOn = false
    micMuted = false
    swapLocalStream(null)
    emit()
  }

  const handlePeerStream = (stream: MediaStream, peerId: string) => {
    if (staleStreamIds.has(stream.id)) return
    peerStreams = { ...peerStreams, [peerId]: stream }
    emit()
  }

  const dropPeer = (peerId: string) => {
    if (!(peerId in peerStreams)) return
    const { [peerId]: gone, ...rest } = peerStreams
    if (gone) staleStreamIds.add(gone.id)
    peerStreams = rest
    emit()
  }

  const handlePeerLeave = (peerId: string) => {
    const gone = peerStreams[peerId]
    if (gone) staleStreamIds.delete(gone.id)
    if (peerId in peerStreams) {
      const { [peerId]: _removed, ...rest } = peerStreams
      peerStreams = rest
      emit()
    }
  }

  const dispose = () => {
    swapLocalStream(null)
    peerStreams = {}
    disposed = true
  }

  return {
    getState: snapshot,
    enableMic,
    disableMic,
    setMicMuted,
    enableCamera,
    disableCamera,
    switchAudioInput,
    switchVideoInput,
    stopMedia,
    handlePeerStream,
    handlePeerLeave,
    handlePeerMediaEnd: dropPeer,
    dispose,
  }
}
