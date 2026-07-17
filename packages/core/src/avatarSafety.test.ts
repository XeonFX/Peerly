import { describe, expect, it } from 'vitest'
import { isSafeAvatarUrl, safeAvatarUrl } from './avatarSafety.js'

describe('isSafeAvatarUrl', () => {
  it('allows common raster data URLs', () => {
    expect(isSafeAvatarUrl('data:image/png;base64,abc')).toBe(true)
    expect(isSafeAvatarUrl('data:image/jpeg;base64,abc')).toBe(true)
    expect(isSafeAvatarUrl('data:image/webp;base64,abc')).toBe(true)
    expect(isSafeAvatarUrl('data:image/gif;base64,abc')).toBe(true)
  })

  it('rejects remote URLs, svg data URLs, and empty values', () => {
    expect(isSafeAvatarUrl('https://evil.example/a.png')).toBe(false)
    expect(isSafeAvatarUrl('data:image/svg+xml;base64,abc')).toBe(false)
    expect(isSafeAvatarUrl(undefined)).toBe(false)
    expect(isSafeAvatarUrl('')).toBe(false)
  })

  it('safeAvatarUrl returns undefined when unsafe', () => {
    expect(safeAvatarUrl('https://x')).toBeUndefined()
    expect(safeAvatarUrl('data:image/png;base64,x')).toBe('data:image/png;base64,x')
  })
})
