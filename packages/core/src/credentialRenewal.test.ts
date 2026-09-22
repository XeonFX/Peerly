import { describe, expect, it } from 'vitest'
import {
  credentialNeedsRenewal,
  credentialRenewalDelay,
  credentialRetryDelay,
} from './credentialRenewal.js'

describe('credential renewal policy', () => {
  const now = 1_000_000

  it('renews a missing credential immediately', () => {
    expect(credentialRenewalDelay(null, now)).toBe(0)
    expect(credentialNeedsRenewal(null, now)).toBe(true)
  })

  it('renews before expiry and never produces a negative delay', () => {
    expect(credentialRenewalDelay(now + 20_000, now, { renewBeforeMs: 5_000 })).toBe(15_000)
    expect(credentialRenewalDelay(now + 4_000, now, { renewBeforeMs: 5_000 })).toBe(0)
  })

  it('caps retries at expiry and stops after expiry', () => {
    expect(credentialRetryDelay(now + 30_000, now, { retryMs: 60_000 })).toBe(30_000)
    expect(credentialRetryDelay(now - 1, now, { retryMs: 60_000 })).toBeNull()
    expect(credentialRetryDelay(null, now, { retryMs: 12_000 })).toBe(12_000)
  })
})
