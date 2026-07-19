/**
 * Peerly preferred media device ids + sink routing.
 * Prefs factory + pure I/O live in @peerly/core; keys stay app-owned.
 */

import {
  audioOutputSelectionSupported,
  createMediaDevicePrefs,
  inferJoinMode,
  listMediaDevices,
  type CallMediaMode,
  type MediaDeviceLists,
} from '@peerly/core'

export { audioOutputSelectionSupported, inferJoinMode, listMediaDevices }
export type { CallMediaMode, MediaDeviceLists }

export const AUDIO_OUTPUT_CHANGED_EVENT = 'peerly-audio-output-changed'

const prefs = createMediaDevicePrefs({
  audioInKey: 'peerly-audio-in',
  videoInKey: 'peerly-video-in',
  audioOutKey: 'peerly-audio-out',
  outputChangedEvent: AUDIO_OUTPUT_CHANGED_EVENT,
})

export const loadPreferredAudioInput = prefs.loadPreferredAudioInput
export const loadPreferredVideoInput = prefs.loadPreferredVideoInput
export const loadPreferredAudioOutput = prefs.loadPreferredAudioOutput
export const savePreferredAudioInput = prefs.savePreferredAudioInput
export const savePreferredVideoInput = prefs.savePreferredVideoInput
export const savePreferredAudioOutput = prefs.savePreferredAudioOutput
export const applyAudioOutput = prefs.applyAudioOutput
