import { describe, expect, it } from 'vitest'
import {
  ATTENTION_SOUND_PREFERENCE_KEY,
  loadAttentionSoundsEnabled,
  saveAttentionSoundsEnabled,
} from './attentionSound'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
    clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}

describe('attentionSound preference', () => {
  it('requires an explicit opt-in and can be disabled again', () => {
    const storage = memoryStorage()
    expect(loadAttentionSoundsEnabled(storage)).toBe(false)

    saveAttentionSoundsEnabled(true, storage)
    expect(storage.getItem(ATTENTION_SOUND_PREFERENCE_KEY)).toBe('enabled')
    expect(loadAttentionSoundsEnabled(storage)).toBe(true)

    saveAttentionSoundsEnabled(false, storage)
    expect(loadAttentionSoundsEnabled(storage)).toBe(false)
  })
})
