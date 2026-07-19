/**
 * Active-speaker / audio-level detection over a live MediaStream.
 *
 * One shared AudioContext feeds an AnalyserNode per stream; we sample RMS
 * loudness and report a debounced "speaking" boolean. The analyser is never
 * connected to destination — playback stays with the app's media elements.
 */

export type SpeakingDetector = { stop: () => void }

let sharedContext: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  sharedContext ??= new Ctor()
  if (sharedContext.state === 'suspended') void sharedContext.resume()
  return sharedContext
}

export type SpeakingDetectorOptions = {
  /** RMS (0..1) at or above which the stream counts as loud. */
  threshold?: number
  /** Sampling cadence. */
  intervalMs?: number
  /** Keep "speaking" true this long after the last loud sample. */
  holdMs?: number
}

export function createSpeakingDetector(
  stream: MediaStream,
  onChange: (speaking: boolean) => void,
  options: SpeakingDetectorOptions = {}
): SpeakingDetector {
  const { threshold = 0.05, intervalMs = 150, holdMs = 600 } = options
  const context = getContext()
  if (!context || stream.getAudioTracks().length === 0) return { stop: () => {} }

  let source: MediaStreamAudioSourceNode
  try {
    source = context.createMediaStreamSource(stream)
  } catch {
    return { stop: () => {} }
  }
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.4
  source.connect(analyser)

  const buffer = new Float32Array(analyser.fftSize)
  let speaking = false
  let lastLoud = 0

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buffer)
    let sum = 0
    for (let i = 0; i < buffer.length; i += 1) sum += buffer[i]! * buffer[i]!
    const rms = Math.sqrt(sum / buffer.length)
    const now = Date.now()
    if (rms >= threshold) lastLoud = now
    const next = now - lastLoud < holdMs
    if (next !== speaking) {
      speaking = next
      onChange(speaking)
    }
  }, intervalMs)

  return {
    stop: () => {
      window.clearInterval(timer)
      try {
        source.disconnect()
        analyser.disconnect()
      } catch {
        // nodes may already be gone
      }
    },
  }
}
