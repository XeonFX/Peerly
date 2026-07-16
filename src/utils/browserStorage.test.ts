import { describe, expect, it } from 'vitest'
import {
  hasRoomForWrite,
  storagePressure,
  type BrowserStorageEstimate,
} from './browserStorage'

const GB = 1024 ** 3
const MB = 1024 ** 2

describe('browserStorage', () => {
  it('uses both relative and absolute pressure thresholds', () => {
    expect(storagePressure(1 * GB, 10 * GB)).toBe('ok')
    expect(storagePressure(8.1 * GB, 10 * GB)).toBe('notice')
    expect(storagePressure(9.1 * GB, 10 * GB)).toBe('warning')
    expect(storagePressure(9.6 * GB, 10 * GB)).toBe('critical')
    expect(storagePressure(420 * MB, 800 * MB)).toBe('notice')
    expect(storagePressure(610 * MB, 800 * MB)).toBe('warning')
    expect(storagePressure(720 * MB, 800 * MB)).toBe('critical')
  })

  it('does not claim pressure when the browser cannot estimate quota', () => {
    expect(storagePressure()).toBe('ok')
    expect(storagePressure(100, 0)).toBe('ok')
  })

  it('reserves headroom before accepting a write', () => {
    const estimate: BrowserStorageEstimate = {
      supported: true,
      usageBytes: 700 * MB,
      quotaBytes: 1024 * MB,
      availableBytes: 324 * MB,
      measuredAt: 0,
    }
    expect(hasRoomForWrite(estimate, 100 * MB)).toBe(true)
    expect(hasRoomForWrite(estimate, 250 * MB)).toBe(false)
    expect(hasRoomForWrite({ supported: false, measuredAt: 0 }, 999 * GB)).toBe(true)
  })
})
