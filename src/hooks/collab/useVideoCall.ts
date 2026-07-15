import type { joinRoom } from '@trystero-p2p/nostr'
import { useCallback, useEffect, useRef, useState } from 'react'

type Room = ReturnType<typeof joinRoom>

export function useVideoCall(room: Room | null) {
  const [inCall, setInCall] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [peerStreams, setPeerStreams] = useState<Record<string, MediaStream>>({})
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)

  const localStreamRef = useRef<MediaStream | null>(null)
  localStreamRef.current = localStream

  const reset = useCallback(() => {
    if (room && localStreamRef.current) {
      room.removeStream(localStreamRef.current)
      localStreamRef.current.getTracks().forEach(track => track.stop())
    }
    setLocalStream(null)
    setInCall(false)
    setPeerStreams({})
    setVideoEnabled(true)
    setAudioEnabled(true)
    setMediaError(null)
  }, [room])

  const onPeerStream = useCallback((stream: MediaStream, peerId: string) => {
    setPeerStreams(prev => ({ ...prev, [peerId]: stream }))
    setInCall(true)
  }, [])

  const onPeerLeave = useCallback((peerId: string) => {
    setPeerStreams(prev => {
      const next = { ...prev }
      delete next[peerId]
      return next
    })
  }, [])

  const onPeerJoin = useCallback(
    (peerId: string) => {
      if (localStreamRef.current && room) {
        room.addStream(localStreamRef.current, { target: peerId })
      }
    },
    [room]
  )

  const startCall = useCallback(async () => {
    if (!room) return
    setMediaError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      })
      setLocalStream(stream)
      setInCall(true)
      room.addStream(stream)
    } catch (err) {
      console.error('Failed to start call:', err)
      setMediaError('Could not access camera/microphone. Please check permissions.')
    }
  }, [room])

  const endCall = useCallback(() => {
    if (!room) return
    if (localStream) {
      room.removeStream(localStream)
      localStream.getTracks().forEach(track => track.stop())
      setLocalStream(null)
    }
    setInCall(false)
    setPeerStreams({})
  }, [localStream, room])

  const toggleVideo = useCallback(() => {
    if (!localStream) return
    const track = localStream.getVideoTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      setVideoEnabled(track.enabled)
    }
  }, [localStream])

  const toggleAudio = useCallback(() => {
    if (!localStream) return
    const track = localStream.getAudioTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      setAudioEnabled(track.enabled)
    }
  }, [localStream])

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  return {
    inCall,
    localStream,
    peerStreams,
    videoEnabled,
    audioEnabled,
    mediaError,
    reset,
    onPeerStream,
    onPeerLeave,
    onPeerJoin,
    startCall,
    endCall,
    toggleVideo,
    toggleAudio,
  }
}