import type { joinRoom } from '@trystero-p2p/nostr'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  inferJoinMode,
  listMediaDevices,
  loadPreferredAudioInput,
  loadPreferredAudioOutput,
  loadPreferredVideoInput,
  savePreferredAudioInput,
  savePreferredAudioOutput,
  savePreferredVideoInput,
  type CallMediaMode,
} from '../../collab/deviceSelection'

type Room = ReturnType<typeof joinRoom>

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => track.stop())
}

/**
 * An unanswered incoming call expires. There is no explicit "call cancelled"
 * signal to observe — the caller ending the call removes their stream, which
 * fires no peer event — so without a timeout the incoming-call banner (and its
 * ringtone) would outlive the call it announces indefinitely.
 */
const INCOMING_CALL_TIMEOUT_MS = 30_000

export function useVideoCall(room: Room | null) {
  const [inCall, setInCall] = useState(false)
  const [callMode, setCallMode] = useState<CallMediaMode>('video')
  const [incomingCallPeerId, setIncomingCallPeerId] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [peerStreams, setPeerStreams] = useState<Record<string, MediaStream>>({})
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInput, setSelectedAudioInput] = useState(() => loadPreferredAudioInput())
  const [selectedVideoInput, setSelectedVideoInput] = useState(() => loadPreferredVideoInput())
  const [selectedAudioOutput, setSelectedAudioOutput] = useState(() => loadPreferredAudioOutput())
  const [mediaError, setMediaError] = useState<string | null>(null)

  const localStreamRef = useRef<MediaStream | null>(null)
  localStreamRef.current = localStream
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const screenSharingRef = useRef(false)
  const callModeRef = useRef<CallMediaMode>('video')
  callModeRef.current = callMode
  const roomRef = useRef(room)
  roomRef.current = room

  /**
   * Stream ids that are residue of a call WE already ended or declined.
   * Ending a call removes only our own stream; the other side keeps
   * transmitting, and any renegotiation re-announces their stream to us.
   * Without this, that re-announcement is indistinguishable from a brand-new
   * incoming call — the ex-caller gets an "incoming call" (and its ringtone)
   * from a conversation they just hung up on. Keyed by stream id, not peer
   * id: a genuine call-back creates a fresh getUserMedia stream with a new
   * id and still rings, while the old stream re-surfacing stays silent.
   */
  const staleStreamIdsRef = useRef(new Set<string>())

  const refreshDevices = useCallback(async () => {
    const lists = await listMediaDevices()
    setAudioInputs(lists.audioInputs)
    setVideoInputs(lists.videoInputs)
    setAudioOutputs(lists.audioOutputs)
  }, [])

  const removeAndStopLocalStreams = useCallback(() => {
    const activeRoom = roomRef.current
    if (activeRoom && localStreamRef.current) activeRoom.removeStream(localStreamRef.current)
    stopStream(localStreamRef.current)
    if (cameraStreamRef.current !== localStreamRef.current) stopStream(cameraStreamRef.current)
    stopStream(displayStreamRef.current)
    localStreamRef.current = null
    cameraStreamRef.current = null
    displayStreamRef.current = null
  }, [])

  const reset = useCallback(() => {
    staleStreamIdsRef.current.clear()
    removeAndStopLocalStreams()
    setLocalStream(null)
    setInCall(false)
    setCallMode('video')
    setIncomingCallPeerId(null)
    setPeerStreams({})
    setVideoEnabled(true)
    setAudioEnabled(true)
    setScreenSharing(false)
    screenSharingRef.current = false
    setMediaError(null)
  }, [removeAndStopLocalStreams])

  const onPeerStream = useCallback((stream: MediaStream, peerId: string) => {
    // A stream id we already hung up on is renegotiation residue, not a call.
    if (!localStreamRef.current && staleStreamIdsRef.current.has(stream.id)) return
    setPeerStreams(prev => ({ ...prev, [peerId]: stream }))
    if (localStreamRef.current) setInCall(true)
    else setIncomingCallPeerId(peerId)
  }, [])

  const onPeerLeave = useCallback((peerId: string) => {
    setPeerStreams(prev => {
      const gone = prev[peerId]
      if (gone) staleStreamIdsRef.current.delete(gone.id)
      const next = { ...prev }
      delete next[peerId]
      return next
    })
    setIncomingCallPeerId(current => (current === peerId ? null : current))
  }, [])

  /**
   * A peer explicitly ended its call. Drop its tile and any incoming banner
   * right away — without this, a cancelled call haunted the callee for the
   * full 30s INCOMING_CALL_TIMEOUT (which remains the fallback for peers
   * that crash instead of hanging up). The dying stream may still re-announce
   * on renegotiation, so its id goes into the stale set.
   */
  const onPeerCallEnd = useCallback((peerId: string) => {
    setPeerStreams(prev => {
      const gone = prev[peerId]
      if (!gone) return prev
      staleStreamIdsRef.current.add(gone.id)
      const next = { ...prev }
      delete next[peerId]
      return next
    })
    setIncomingCallPeerId(current => (current === peerId ? null : current))
  }, [])

  const onPeerJoin = useCallback((peerId: string) => {
    const activeRoom = roomRef.current
    if (localStreamRef.current && activeRoom) {
      activeRoom.addStream(localStreamRef.current, { target: peerId })
    }
  }, [])

  const acquireLocalStream = useCallback(
    (mode: CallMediaMode, audioId = selectedAudioInput, videoId = selectedVideoInput) => {
      const audioConstraint: MediaTrackConstraints | boolean = audioId
        ? { deviceId: { exact: audioId } }
        : true
      if (mode === 'audio') {
        return navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: false,
        })
      }
      return navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
        video: videoId ? { deviceId: { exact: videoId } } : true,
      })
    },
    [selectedAudioInput, selectedVideoInput]
  )

  const startCall = useCallback(
    async (mode: CallMediaMode = 'video') => {
      const activeRoom = roomRef.current
      if (!activeRoom || localStreamRef.current) {
        if (localStreamRef.current) {
          setInCall(true)
          setIncomingCallPeerId(null)
        }
        return
      }
      setMediaError(null)
      try {
        const stream = await acquireLocalStream(mode)
        cameraStreamRef.current = stream
        localStreamRef.current = stream
        setLocalStream(stream)
        setCallMode(mode)
        setInCall(true)
        setIncomingCallPeerId(null)
        setVideoEnabled(stream.getVideoTracks().some(track => track.enabled))
        setAudioEnabled(stream.getAudioTracks().some(track => track.enabled))
        activeRoom.addStream(stream)
        await refreshDevices()
        const audioId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? ''
        const videoId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? ''
        if (audioId) {
          setSelectedAudioInput(audioId)
          savePreferredAudioInput(audioId)
        }
        if (videoId) {
          setSelectedVideoInput(videoId)
          savePreferredVideoInput(videoId)
        }
      } catch (err) {
        console.error('Failed to start call:', err)
        setMediaError(
          mode === 'audio'
            ? 'Could not access microphone. Please check permissions.'
            : 'Could not access camera/microphone. Please check permissions.'
        )
      }
    },
    [acquireLocalStream, refreshDevices]
  )

  /** Join an incoming call, matching the caller's audio vs video tracks. */
  const joinCall = useCallback(async () => {
    const peerId = incomingCallPeerId
    const peerStream = peerId ? peerStreams[peerId] : null
    await startCall(inferJoinMode(peerStream))
  }, [incomingCallPeerId, peerStreams, startCall])

  const declineCall = useCallback(() => {
    setIncomingCallPeerId(null)
    setPeerStreams(prev => {
      for (const stream of Object.values(prev)) staleStreamIdsRef.current.add(stream.id)
      return {}
    })
  }, [])

  useEffect(() => {
    if (!incomingCallPeerId || inCall) return
    const timer = window.setTimeout(declineCall, INCOMING_CALL_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [incomingCallPeerId, inCall, declineCall])

  const endCall = useCallback(() => {
    removeAndStopLocalStreams()
    setLocalStream(null)
    setInCall(false)
    setCallMode('video')
    setIncomingCallPeerId(null)
    setPeerStreams(prev => {
      for (const stream of Object.values(prev)) staleStreamIdsRef.current.add(stream.id)
      return {}
    })
    setScreenSharing(false)
    screenSharingRef.current = false
  }, [removeAndStopLocalStreams])

  const toggleVideo = useCallback(() => {
    const track = cameraStreamRef.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setVideoEnabled(track.enabled)
  }, [])

  const toggleAudio = useCallback(() => {
    const track = (cameraStreamRef.current ?? localStreamRef.current)?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setAudioEnabled(track.enabled)
  }, [])

  const stopScreenShare = useCallback(() => {
    const activeRoom = roomRef.current
    const camera = cameraStreamRef.current
    const shared = localStreamRef.current
    if (!screenSharingRef.current || !activeRoom || !camera || !shared) return
    activeRoom.removeStream(shared)
    stopStream(displayStreamRef.current)
    displayStreamRef.current = null
    localStreamRef.current = camera
    setLocalStream(camera)
    setScreenSharing(false)
    screenSharingRef.current = false
    activeRoom.addStream(camera)
  }, [])

  const startScreenShare = useCallback(async () => {
    const activeRoom = roomRef.current
    const camera = cameraStreamRef.current
    if (!activeRoom || !camera || !navigator.mediaDevices.getDisplayMedia) return
    if (callModeRef.current === 'audio') return
    setMediaError(null)
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const displayTrack = display.getVideoTracks()[0]
      if (!displayTrack) return
      displayStreamRef.current = display
      const shared = new MediaStream([displayTrack, ...camera.getAudioTracks()])
      if (localStreamRef.current) activeRoom.removeStream(localStreamRef.current)
      localStreamRef.current = shared
      setLocalStream(shared)
      setScreenSharing(true)
      screenSharingRef.current = true
      activeRoom.addStream(shared)
      displayTrack.addEventListener('ended', () => stopScreenShare(), { once: true })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') return
      console.error('Failed to share screen:', err)
      setMediaError('Could not start screen sharing.')
    }
  }, [stopScreenShare])

  const switchDevices = useCallback(
    async (audioId: string, videoId: string) => {
      if (screenSharing) return
      setMediaError(null)
      setSelectedAudioInput(audioId)
      setSelectedVideoInput(videoId)
      savePreferredAudioInput(audioId)
      if (videoId) savePreferredVideoInput(videoId)
      if (!localStreamRef.current) return
      try {
        const next = await acquireLocalStream(callModeRef.current, audioId, videoId)
        const activeRoom = roomRef.current
        if (activeRoom && localStreamRef.current) activeRoom.removeStream(localStreamRef.current)
        stopStream(localStreamRef.current)
        cameraStreamRef.current = next
        localStreamRef.current = next
        setLocalStream(next)
        setVideoEnabled(next.getVideoTracks().some(track => track.enabled))
        setAudioEnabled(next.getAudioTracks().some(track => track.enabled))
        if (activeRoom) activeRoom.addStream(next)
      } catch (err) {
        console.error('Failed to switch media device:', err)
        setMediaError('Could not switch camera or microphone.')
      }
    },
    [acquireLocalStream, screenSharing]
  )

  const setAudioOutput = useCallback((deviceId: string) => {
    setSelectedAudioOutput(deviceId)
    savePreferredAudioOutput(deviceId)
  }, [])

  /** Upgrade an audio-only call to include a camera (or re-open camera). */
  const enableCamera = useCallback(async () => {
    if (screenSharingRef.current || !localStreamRef.current) return
    if (callModeRef.current === 'video' && cameraStreamRef.current?.getVideoTracks().length) {
      toggleVideo()
      return
    }
    setMediaError(null)
    try {
      const next = await acquireLocalStream('video')
      const activeRoom = roomRef.current
      if (activeRoom && localStreamRef.current) activeRoom.removeStream(localStreamRef.current)
      stopStream(localStreamRef.current)
      cameraStreamRef.current = next
      localStreamRef.current = next
      setLocalStream(next)
      setCallMode('video')
      setVideoEnabled(true)
      setAudioEnabled(next.getAudioTracks().some(track => track.enabled))
      if (activeRoom) activeRoom.addStream(next)
      const videoId = next.getVideoTracks()[0]?.getSettings().deviceId ?? ''
      if (videoId) {
        setSelectedVideoInput(videoId)
        savePreferredVideoInput(videoId)
      }
      await refreshDevices()
    } catch (err) {
      console.error('Failed to enable camera:', err)
      setMediaError('Could not access camera. Please check permissions.')
    }
  }, [acquireLocalStream, refreshDevices, toggleVideo])

  useEffect(() => () => removeAndStopLocalStreams(), [removeAndStopLocalStreams])

  return {
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
    reset,
    onPeerStream,
    onPeerCallEnd,
    onPeerLeave,
    onPeerJoin,
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
  }
}
