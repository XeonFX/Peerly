import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMediaDevicePrefs } from './mediaDevicePrefs.js'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createMediaDevicePrefs', () => {
  const prefs = createMediaDevicePrefs({
    audioInKey: 't-audio-in',
    videoInKey: 't-video-in',
    audioOutKey: 't-audio-out',
    outputChangedEvent: 't-audio-out-changed',
  })

  it('persists preferred devices', () => {
    prefs.savePreferredAudioInput('mic-1')
    prefs.savePreferredVideoInput('cam-1')
    prefs.savePreferredAudioOutput('spk-1')
    expect(prefs.loadPreferredAudioInput()).toBe('mic-1')
    expect(prefs.loadPreferredVideoInput()).toBe('cam-1')
    expect(prefs.loadPreferredAudioOutput()).toBe('spk-1')
  })

  it('clears empty values', () => {
    prefs.savePreferredAudioOutput('x')
    prefs.savePreferredAudioOutput('')
    expect(prefs.loadPreferredAudioOutput()).toBe('')
  })
})
