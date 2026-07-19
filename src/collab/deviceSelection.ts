/**
 * Persist preferred media device ids. Empty string = browser default.
 * Inputs feed getUserMedia constraints; output uses HTMLMediaElement.setSinkId.
 */

const AUDIO_IN_KEY = 'peerly-audio-in'
const VIDEO_IN_KEY = 'peerly-video-in'
const AUDIO_OUT_KEY = 'peerly-audio-out'

/** Fired when the user picks a new playback device so live media elements rebind. */
export const AUDIO_OUTPUT_CHANGED_EVENT = 'peerly-audio-output-changed'

function read(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string): void {
  try {
    if (!value) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // private mode / quota
  }
}

export function loadPreferredAudioInput(): string {
  return read(AUDIO_IN_KEY)
}

export function loadPreferredVideoInput(): string {
  return read(VIDEO_IN_KEY)
}

export function loadPreferredAudioOutput(): string {
  return read(AUDIO_OUT_KEY)
}

export function savePreferredAudioInput(deviceId: string): void {
  write(AUDIO_IN_KEY, deviceId.trim())
}

export function savePreferredVideoInput(deviceId: string): void {
  write(VIDEO_IN_KEY, deviceId.trim())
}

export function savePreferredAudioOutput(deviceId: string): void {
  write(AUDIO_OUT_KEY, deviceId.trim())
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUDIO_OUTPUT_CHANGED_EVENT))
  }
}

/** True when this browser can route playback to a chosen sink. */
export function audioOutputSelectionSupported(): boolean {
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function'
  )
}

/**
 * Route an audio/video element to the preferred output device (or default).
 * No-ops when setSinkId is missing (Safari) or the device id is empty/invalid.
 */
export async function applyAudioOutput(
  element: HTMLMediaElement | null | undefined,
  deviceId?: string
): Promise<void> {
  if (!element || !audioOutputSelectionSupported()) return
  const id = (deviceId ?? loadPreferredAudioOutput()).trim()
  try {
    // Empty id = system default sink.
    await element.setSinkId(id)
  } catch {
    // Device unplugged / not allowed — leave previous sink.
  }
}

export type MediaDeviceLists = {
  audioInputs: MediaDeviceInfo[]
  videoInputs: MediaDeviceInfo[]
  audioOutputs: MediaDeviceInfo[]
}

/** Enumerate devices; may need a prior getUserMedia grant for labels. */
export async function listMediaDevices(): Promise<MediaDeviceLists> {
  if (!navigator.mediaDevices?.enumerateDevices) {
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
 * (`MediaStreamTrack.readyState` is only `"live" | "ended"` in the lib.)
 */
export function inferJoinMode(stream: MediaStream | null | undefined): CallMediaMode {
  if (!stream) return 'video'
  const hasVideo = stream.getVideoTracks().some(track => track.readyState !== 'ended')
  return hasVideo ? 'video' : 'audio'
}
