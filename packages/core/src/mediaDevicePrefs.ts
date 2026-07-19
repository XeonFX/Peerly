/**
 * App-owned preferred mic/camera/speaker device ids in localStorage.
 * Empty string = browser default. Pure I/O helpers live in mediaDevices.ts.
 */

import { applyAudioOutput as coreApplyAudioOutput } from './mediaDevices.js'

export type MediaDevicePrefsConfig = {
  /** e.g. peerly-audio-in */
  audioInKey: string
  videoInKey: string
  audioOutKey: string
  /** CustomEvent / Event name when speakers change (so live elements rebind). */
  outputChangedEvent: string
}

export type MediaDevicePrefs = {
  loadPreferredAudioInput: () => string
  loadPreferredVideoInput: () => string
  loadPreferredAudioOutput: () => string
  savePreferredAudioInput: (deviceId: string) => void
  savePreferredVideoInput: (deviceId: string) => void
  savePreferredAudioOutput: (deviceId: string) => void
  /** Apply preferred (or explicit) sink to a media element. */
  applyAudioOutput: (
    element: HTMLMediaElement | null | undefined,
    deviceId?: string
  ) => Promise<void>
  outputChangedEvent: string
}

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

export function createMediaDevicePrefs(config: MediaDevicePrefsConfig): MediaDevicePrefs {
  const loadOut = () => read(config.audioOutKey)
  return {
    outputChangedEvent: config.outputChangedEvent,
    loadPreferredAudioInput: () => read(config.audioInKey),
    loadPreferredVideoInput: () => read(config.videoInKey),
    loadPreferredAudioOutput: loadOut,
    savePreferredAudioInput: deviceId => write(config.audioInKey, deviceId.trim()),
    savePreferredVideoInput: deviceId => write(config.videoInKey, deviceId.trim()),
    savePreferredAudioOutput: deviceId => {
      write(config.audioOutKey, deviceId.trim())
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(config.outputChangedEvent))
      }
    },
    applyAudioOutput: async (element, deviceId) => {
      const id = (deviceId ?? loadOut()).trim()
      await coreApplyAudioOutput(element, id)
    },
  }
}
