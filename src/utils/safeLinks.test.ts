import { describe, expect, it } from 'vitest'
import { firstSafeLink, splitSafeLinks } from './safeLinks'

describe('splitSafeLinks', () => {
  it('linkifies only https and keeps sentence punctuation outside the link', () => {
    expect(splitSafeLinks('See https://example.com/docs?q=1.')).toEqual([
      { kind: 'text', value: 'See ' },
      { kind: 'link', value: 'https://example.com/docs?q=1', href: 'https://example.com/docs?q=1' },
      { kind: 'text', value: '.' },
    ])
  })

  it('leaves non-https and malformed text inert', () => {
    expect(splitSafeLinks('http://example.com javascript:alert(1)')).toEqual([
      { kind: 'text', value: 'http://example.com javascript:alert(1)' },
    ])
  })

  it('returns the first visible URL without trailing sentence punctuation', () => {
    expect(
      firstSafeLink('First https://one.example/docs, then https://two.example.')
    ).toBe('https://one.example/docs')
    expect(firstSafeLink('No safe link: http://example.com')).toBeNull()
  })

  it('recognizes a missing-colon HTTPS typo and copies its safe canonical form', () => {
    expect(splitSafeLinks('Open https//heyhubs.app today')).toEqual([
      { kind: 'text', value: 'Open ' },
      { kind: 'link', value: 'https//heyhubs.app', href: 'https://heyhubs.app/' },
      { kind: 'text', value: ' today' },
    ])
    expect(firstSafeLink('Open https//heyhubs.app today')).toBe('https://heyhubs.app/')
  })
})
