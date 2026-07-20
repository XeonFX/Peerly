/**
 * Browser media device helpers shared by consumer call UIs.
 * Storage keys for preferred devices stay app-owned; this module is pure I/O
 * against the Web APIs plus optional sink apply.
 */

export type MediaDeviceLists = {
  audioInputs: MediaDeviceInfo[]
  videoInputs: MediaDeviceInfo[]
  audioOutputs: MediaDeviceInfo[]
}

/** True when this browser can route playback to a chosen sink. */
export function audioOutputSelectionSupported(): boolean {
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId ===
      'function'
  )
}

/**
 * Route an audio/video element to a sink. Empty `deviceId` = system default.
 * No-ops when setSinkId is missing (Safari) or the id is invalid.
 */
export async function applyAudioOutput(
  element: HTMLMediaElement | null | undefined,
  deviceId = ''
): Promise<void> {
  if (!element || !audioOutputSelectionSupported()) return
  const id = deviceId.trim()
  try {
    await (
      element as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> }
    ).setSinkId(id)
  } catch {
    // Device unplugged / not allowed — leave previous sink.
  }
}

/** Enumerate devices; may need a prior getUserMedia grant for labels. */
export async function listMediaDevices(): Promise<MediaDeviceLists> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { audioInputs: [], videoInputs: [], audioOutputs: [] }
  }
  const all = await navigator.mediaDevices.enumerateDevices()
  return {
    audioInputs: all.filter(d => d.kind === 'audioinput'),
    videoInputs: all.filter(d => d.kind === 'videoinput'),
    audioOutputs: all.filter(d => d.kind === 'audiooutput'),
  }
}

export type CallMediaMode = 'audio' | 'video'

/**
 * When joining an incoming stream, match the caller's media: if they have a
 * non-ended video track join as video, otherwise as audio-only.
 */
export function inferJoinMode(stream: MediaStream | null | undefined): CallMediaMode {
  if (!stream) return 'video'
  const hasVideo = stream.getVideoTracks().some(track => track.readyState !== 'ended')
  return hasVideo ? 'video' : 'audio'
}
