/**
 * Peerly preferred media device ids + sink routing.
 * Pure Web API helpers live in @peerly/core; storage keys stay app-owned.
 */

import {
  applyAudioOutput as coreApplyAudioOutput,
  audioOutputSelectionSupported,
  inferJoinMode,
  listMediaDevices,
  type CallMediaMode,
  type MediaDeviceLists,
} from '@peerly/core'

const AUDIO_IN_KEY = 'peerly-audio-in'
const VIDEO_IN_KEY = 'peerly-video-in'
const AUDIO_OUT_KEY = 'peerly-audio-out'

/** Fired when the user picks a new playback device so live media elements rebind. */
export const AUDIO_OUTPUT_CHANGED_EVENT = 'peerly-audio-output-changed'

export { audioOutputSelectionSupported, inferJoinMode, listMediaDevices }
export type { CallMediaMode, MediaDeviceLists }

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

/**
 * Route an element to the preferred (or explicit) output device.
 */
export async function applyAudioOutput(
  element: HTMLMediaElement | null | undefined,
  deviceId?: string
): Promise<void> {
  const id = (deviceId ?? loadPreferredAudioOutput()).trim()
  await coreApplyAudioOutput(element, id)
}
