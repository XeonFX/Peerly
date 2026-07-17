import type { joinRoom } from '@trystero-p2p/nostr'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [incomingCallPeerId, setIncomingCallPeerId] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [peerStreams, setPeerStreams] = useState<Record<string, MediaStream>>({})
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInput, setSelectedAudioInput] = useState('')
  const [selectedVideoInput, setSelectedVideoInput] = useState('')
  const [mediaError, setMediaError] = useState<string | null>(null)

  const localStreamRef = useRef<MediaStream | null>(null)
  localStreamRef.current = localStream
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const screenSharingRef = useRef(false)
  const roomRef = useRef(room)
  roomRef.current = room

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    setAudioInputs(devices.filter(device => device.kind === 'audioinput'))
    setVideoInputs(devices.filter(device => device.kind === 'videoinput'))
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
    removeAndStopLocalStreams()
    setLocalStream(null)
    setInCall(false)
    setIncomingCallPeerId(null)
    setPeerStreams({})
    setVideoEnabled(true)
    setAudioEnabled(true)
    setScreenSharing(false)
    screenSharingRef.current = false
    setMediaError(null)
  }, [removeAndStopLocalStreams])

  const onPeerStream = useCallback((stream: MediaStream, peerId: string) => {
    setPeerStreams(prev => ({ ...prev, [peerId]: stream }))
    if (localStreamRef.current) setInCall(true)
    else setIncomingCallPeerId(peerId)
  }, [])

  const onPeerLeave = useCallback((peerId: string) => {
    setPeerStreams(prev => {
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

  const acquireCameraStream = useCallback(
    (audioId = selectedAudioInput, videoId = selectedVideoInput) =>
      navigator.mediaDevices.getUserMedia({
        audio: audioId ? { deviceId: { exact: audioId } } : true,
        video: videoId ? { deviceId: { exact: videoId } } : true,
      }),
    [selectedAudioInput, selectedVideoInput]
  )

  const startCall = useCallback(async () => {
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
      const stream = await acquireCameraStream()
      cameraStreamRef.current = stream
      localStreamRef.current = stream
      setLocalStream(stream)
      setInCall(true)
      setIncomingCallPeerId(null)
      setVideoEnabled(stream.getVideoTracks().some(track => track.enabled))
      setAudioEnabled(stream.getAudioTracks().some(track => track.enabled))
      activeRoom.addStream(stream)
      await refreshDevices()
      setSelectedAudioInput(stream.getAudioTracks()[0]?.getSettings().deviceId ?? '')
      setSelectedVideoInput(stream.getVideoTracks()[0]?.getSettings().deviceId ?? '')
    } catch (err) {
      console.error('Failed to start call:', err)
      setMediaError('Could not access camera/microphone. Please check permissions.')
    }
  }, [acquireCameraStream, refreshDevices])

  const declineCall = useCallback(() => {
    setIncomingCallPeerId(null)
    setPeerStreams({})
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
    setIncomingCallPeerId(null)
    setPeerStreams({})
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
      if (!localStreamRef.current) return
      try {
        const next = await acquireCameraStream(audioId, videoId)
        const activeRoom = roomRef.current
        if (activeRoom && localStreamRef.current) activeRoom.removeStream(localStreamRef.current)
        stopStream(localStreamRef.current)
        cameraStreamRef.current = next
        localStreamRef.current = next
        setLocalStream(next)
        if (activeRoom) activeRoom.addStream(next)
      } catch (err) {
        console.error('Failed to switch media device:', err)
        setMediaError('Could not switch camera or microphone.')
      }
    },
    [acquireCameraStream, screenSharing]
  )

  useEffect(() => () => removeAndStopLocalStreams(), [removeAndStopLocalStreams])

  return {
    inCall,
    incomingCallPeerId,
    localStream,
    peerStreams,
    videoEnabled,
    audioEnabled,
    screenSharing,
    audioInputs,
    videoInputs,
    selectedAudioInput,
    selectedVideoInput,
    mediaError,
    reset,
    onPeerStream,
    onPeerLeave,
    onPeerJoin,
    startCall,
    declineCall,
    endCall,
    toggleVideo,
    toggleAudio,
    startScreenShare,
    stopScreenShare,
    switchDevices,
  }
}
