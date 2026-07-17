// Shared attention audio lives in @peerly/core; Peerly keeps a thin façade
// with the historical preference key and export names.
import {
  loadAttentionSoundsEnabled as loadCore,
  playNotificationChime,
  primeAttentionAudio,
  saveAttentionSoundsEnabled as saveCore,
  startIncomingCallRingtone,
} from '@peerly/core'

const APP_ID = 'peerly'

/** @deprecated Prefer attentionSoundPreferenceKey('peerly') from core. */
export const ATTENTION_SOUND_PREFERENCE_KEY = 'peerly-attention-sounds'

export function loadAttentionSoundsEnabled(storage: Storage = localStorage): boolean {
  return loadCore(APP_ID, storage)
}

export function saveAttentionSoundsEnabled(
  enabled: boolean,
  storage: Storage = localStorage
): void {
  saveCore(APP_ID, enabled, storage)
}

export { primeAttentionAudio, startIncomingCallRingtone }

export function playDirectMessageChime(): void {
  playNotificationChime()
}
