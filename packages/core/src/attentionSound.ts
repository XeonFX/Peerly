/**
 * Browser attention audio: chimes and ringers that only play after a user
 * gesture has unlocked AudioContext (autoplay policy).
 *
 * Preference storage is keyed by the app so Peerly and HeyHubs do not share a
 * single toggle.
 */

export function attentionSoundPreferenceKey(appId: string): string {
  return `${appId}-attention-sounds`
}

export function loadAttentionSoundsEnabled(
  appId: string,
  storage: Storage = localStorage
): boolean {
  return storage.getItem(attentionSoundPreferenceKey(appId)) === 'enabled'
}

export function saveAttentionSoundsEnabled(
  appId: string,
  enabled: boolean,
  storage: Storage = localStorage
): void {
  const key = attentionSoundPreferenceKey(appId)
  if (enabled) storage.setItem(key, 'enabled')
  else storage.removeItem(key)
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  audioContext ??= new Ctor()
  return audioContext
}

/** Call from a user gesture so later background chimes are allowed to play. */
export async function primeAttentionAudio(): Promise<boolean> {
  const context = getAudioContext()
  if (!context) return false
  if (context.state === 'suspended') await context.resume()
  return context.state === 'running'
}

function playNotes(notes: Array<{ frequency: number; offset: number; duration: number }>): void {
  const context = getAudioContext()
  if (!context || context.state !== 'running') return
  const start = context.currentTime
  for (const note of notes) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = note.frequency
    gain.gain.setValueAtTime(0.0001, start + note.offset)
    gain.gain.exponentialRampToValueAtTime(0.12, start + note.offset + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.offset + note.duration)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start + note.offset)
    oscillator.stop(start + note.offset + note.duration + 0.02)
  }
}

/** Short two-note cue for match found / DM / room message. */
export function playNotificationChime(): void {
  playNotes([
    { frequency: 659.25, offset: 0, duration: 0.12 },
    { frequency: 880, offset: 0.11, duration: 0.18 },
  ])
}

/** Slightly brighter cue used when a random match succeeds. */
export function playMatchChime(): void {
  playNotes([
    { frequency: 880, offset: 0, duration: 0.1 },
    { frequency: 1174.66, offset: 0.09, duration: 0.16 },
  ])
}

const RING_INTERVAL_MS = 2_800
/** ~28s of ringing — a phone's "missed call", not an alarm clock. */
const MAX_RINGS = 10

/**
 * Repeats a gentle two-note call cue until joined or dismissed — but never
 * forever: unanswered rings must give up on their own.
 */
export function startIncomingCallRingtone(): () => void {
  const ring = () =>
    playNotes([
      { frequency: 523.25, offset: 0, duration: 0.22 },
      { frequency: 783.99, offset: 0.24, duration: 0.32 },
    ])
  ring()
  let rings = 1
  const interval = window.setInterval(() => {
    rings++
    if (rings > MAX_RINGS) {
      window.clearInterval(interval)
      return
    }
    ring()
  }, RING_INTERVAL_MS)
  return () => window.clearInterval(interval)
}

/** Document title with optional unread badge: `(3) HeyHubs`. */
export function formatUnreadTitle(base: string, unread: number): string {
  if (unread <= 0) return base
  const label = unread > 99 ? '99+' : String(unread)
  return `(${label}) ${base}`
}
