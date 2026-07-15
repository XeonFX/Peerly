import { describe, expect, it } from 'vitest'
import { isSafeAvatarUrl, safeAvatarUrl } from './avatarUrl'
import { safeColor, safeDisplayName, sanitizePeerProfile } from './profileSanitize'

describe('avatar url validation', () => {
  it('accepts inline image data we produced', () => {
    expect(isSafeAvatarUrl('data:image/webp;base64,abc')).toBe(true)
    expect(isSafeAvatarUrl('data:image/png;base64,abc')).toBe(true)
  })

  it('rejects urls that would make the browser call out to a peer-chosen host', () => {
    // Each of these would leak the viewer's IP and User-Agent to the sender.
    expect(isSafeAvatarUrl('https://attacker.example/track.gif')).toBe(false)
    expect(isSafeAvatarUrl('http://attacker.example/track.gif')).toBe(false)
    expect(isSafeAvatarUrl('//attacker.example/track.gif')).toBe(false)
    expect(safeAvatarUrl('https://attacker.example/track.gif')).toBeUndefined()
  })

  it('rejects non-image and script-capable data urls', () => {
    expect(isSafeAvatarUrl('data:text/html;base64,abc')).toBe(false)
    expect(isSafeAvatarUrl('data:image/svg+xml;base64,abc')).toBe(false)
    expect(isSafeAvatarUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('color validation', () => {
  it('accepts hex colors', () => {
    expect(safeColor('#fff', '#000')).toBe('#fff')
    expect(safeColor('#36C5F0', '#000')).toBe('#36C5F0')
  })

  it('rejects css that would fetch a peer-chosen url', () => {
    expect(safeColor('url(https://attacker.example/x.png)', '#000')).toBe('#000')
    expect(safeColor('red; background-image: url(https://a.example/x)', '#000')).toBe('#000')
    expect(safeColor('', '#000')).toBe('#000')
  })
})

describe('display name validation', () => {
  it('falls back when empty and truncates hostile lengths', () => {
    expect(safeDisplayName('   ', 'fallback')).toBe('fallback')
    expect(safeDisplayName(undefined, 'fallback')).toBe('fallback')
    expect(safeDisplayName('a'.repeat(5000), 'fallback')).toHaveLength(64)
  })
})

describe('sanitizePeerProfile', () => {
  it('scrubs a fully hostile inbound profile', () => {
    const clean = sanitizePeerProfile(
      {
        name: 'x'.repeat(1000),
        color: 'url(https://attacker.example/beacon)',
        avatar: 'https://attacker.example/beacon.gif',
      },
      { name: 'Peer', color: '#ababad' }
    )

    expect(clean.name).toHaveLength(64)
    expect(clean.color).toBe('#ababad')
    expect(clean.avatar).toBeUndefined()
  })
})
