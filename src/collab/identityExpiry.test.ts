import { describe, expect, it } from 'vitest'
import { EXPIRY_WARN_MS, identityExpiryPhase, msUntilPhaseChange } from './identityExpiry'

const T = 1_000_000_000

describe('identityExpiryPhase', () => {
  it('is ok well before the warning window', () => {
    expect(identityExpiryPhase(T, T - EXPIRY_WARN_MS - 1)).toBe('ok')
  })

  it('warns inside the window and expires at the boundary', () => {
    expect(identityExpiryPhase(T, T - EXPIRY_WARN_MS)).toBe('expiring')
    expect(identityExpiryPhase(T, T - 1)).toBe('expiring')
    expect(identityExpiryPhase(T, T)).toBe('expired')
    expect(identityExpiryPhase(T, T + 1)).toBe('expired')
  })

  it('treats a missing token as expired — sessions outlive tokens now', () => {
    expect(identityExpiryPhase(null, T)).toBe('expired')
  })
})

describe('msUntilPhaseChange', () => {
  it('targets the warning boundary first, then expiry', () => {
    expect(msUntilPhaseChange(T, T - EXPIRY_WARN_MS - 60_000)).toBe(60_000)
    expect(msUntilPhaseChange(T, T - 60_000)).toBe(60_000)
  })

  it('returns null once expired or unknown — no timer to schedule', () => {
    expect(msUntilPhaseChange(T, T)).toBeNull()
    expect(msUntilPhaseChange(null, T)).toBeNull()
  })

  it('never schedules sooner than a second, absorbing timer drift', () => {
    expect(msUntilPhaseChange(T, T - EXPIRY_WARN_MS + 10)).toBeGreaterThanOrEqual(1_000)
  })
})
