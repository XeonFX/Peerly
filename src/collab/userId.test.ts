import { describe, expect, it } from 'vitest'
import { deriveUserId } from './userId'

describe('deriveUserId', () => {
  it('is deterministic for the same issuer and subject', async () => {
    const a = await deriveUserId('https://accounts.google.com', '12345')
    const b = await deriveUserId('https://accounts.google.com', '12345')
    expect(a).toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('differs across subjects and across issuers', async () => {
    const google = await deriveUserId('https://accounts.google.com', '12345')
    const otherSub = await deriveUserId('https://accounts.google.com', '54321')
    const microsoft = await deriveUserId('https://login.microsoftonline.com/x/v2.0', '12345')
    expect(google).not.toBe(otherSub)
    expect(google).not.toBe(microsoft)
  })
})
