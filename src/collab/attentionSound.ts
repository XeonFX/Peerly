export const ATTENTION_SOUND_PREFERENCE_KEY = 'peerly-attention-sounds'

export function loadAttentionSoundsEnabled(storage: Storage = localStorage): boolean {
  return storage.getItem(ATTENTION_SOUND_PREFERENCE_KEY) === 'enabled'
}

export function saveAttentionSoundsEnabled(
  enabled: boolean,
  storage: Storage = localStorage
): void {
  if (enabled) storage.setItem(ATTENTION_SOUND_PREFERENCE_KEY, 'enabled')
  else storage.removeItem(ATTENTION_SOUND_PREFERENCE_KEY)
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return null
  audioContext ??= new AudioContextClass()
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

export function playDirectMessageChime(): void {
  playNotes([
    { frequency: 659.25, offset: 0, duration: 0.12 },
    { frequency: 880, offset: 0.11, duration: 0.18 },
  ])
}

/** Repeats a gentle two-note call cue until the caller is joined or dismissed. */
export function startIncomingCallRingtone(): () => void {
  const ring = () =>
    playNotes([
      { frequency: 523.25, offset: 0, duration: 0.22 },
      { frequency: 783.99, offset: 0.24, duration: 0.32 },
    ])
  ring()
  const interval = window.setInterval(ring, 2800)
  return () => window.clearInterval(interval)
}
