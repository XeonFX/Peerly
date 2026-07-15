import { describe, expect, it } from 'vitest'
import { base64UrlToUtf8, bytesToBase64Url, base64UrlToBytes, utf8ToBase64Url } from './base64url'

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(37))
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes)
  })

  it('round-trips utf8 text, including unicode', () => {
    const text = 'hello — wörld 🎉'
    expect(base64UrlToUtf8(utf8ToBase64Url(text))).toBe(text)
  })

  it('produces URL-safe output with no padding', () => {
    const encoded = bytesToBase64Url(new Uint8Array([251, 255, 191, 255, 255]))
    expect(encoded).not.toMatch(/[+/=]/)
  })
})
