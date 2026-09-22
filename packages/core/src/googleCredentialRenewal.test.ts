import { describe, expect, it } from 'vitest'
import { googleIdentityMatchesRemembered } from './googleCredentialRenewal.js'

describe('googleIdentityMatchesRemembered', () => {
  it('accepts the same durable identity and case-insensitive email', () => {
    expect(
      googleIdentityMatchesRemembered(
        { email: 'Alice@Example.com' },
        'user-1',
        { email: 'alice@example.com', userId: 'user-1' }
      )
    ).toBe(true)
  })

  it('rejects silent account switches by subject or email', () => {
    expect(
      googleIdentityMatchesRemembered(
        { email: 'alice@example.com' },
        'user-2',
        { email: 'alice@example.com', userId: 'user-1' }
      )
    ).toBe(false)
    expect(
      googleIdentityMatchesRemembered(
        { email: 'other@example.com' },
        'user-1',
        { email: 'alice@example.com' }
      )
    ).toBe(false)
  })
})
