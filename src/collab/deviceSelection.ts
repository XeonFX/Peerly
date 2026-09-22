/**
 * This app's preferred media devices and sink routing.
 *
 * The selection itself lives in @peerly/core; only the storage scope is
 * app-owned, so the two products never share a preference.
 */
import {
  audioOutputSelectionSupported,
  createDeviceSelection,
  inferJoinMode,
  listMediaDevices,
  type CallMediaMode,
  type MediaDeviceLists,
} from '@peerly/core'
import { APP_STORAGE_SCOPE } from '../config'

export { audioOutputSelectionSupported, inferJoinMode, listMediaDevices }
export type { CallMediaMode, MediaDeviceLists }

const selection = createDeviceSelection(APP_STORAGE_SCOPE)

export const AUDIO_OUTPUT_CHANGED_EVENT = selection.outputChangedEvent
export const loadPreferredAudioInput = selection.loadPreferredAudioInput
export const loadPreferredVideoInput = selection.loadPreferredVideoInput
export const loadPreferredAudioOutput = selection.loadPreferredAudioOutput
export const savePreferredAudioInput = selection.savePreferredAudioInput
export const savePreferredVideoInput = selection.savePreferredVideoInput
export const savePreferredAudioOutput = selection.savePreferredAudioOutput
export const applyAudioOutput = selection.applyAudioOutput
