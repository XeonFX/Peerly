import { describe, expect, it } from 'vitest'
import { hashEmail, isPlausibleEmail, normalizeEmail } from './emailHash'

describe('emailHash', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com')
  })

  it('rejects implausible addresses', () => {
    expect(isPlausibleEmail('')).toBe(false)
    expect(isPlausibleEmail('no-at')).toBe(false)
    expect(isPlausibleEmail('a@b')).toBe(false)
    expect(isPlausibleEmail('ada@example.com')).toBe(true)
  })

  it('hashes stably and case-insensitively', async () => {
    const a = await hashEmail('Ada@Example.com')
    const b = await hashEmail('ada@example.com')
    expect(a).toHaveLength(64)
    expect(a).toBe(b)
    expect(a).not.toBe(await hashEmail('bob@example.com'))
  })
})
