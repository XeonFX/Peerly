import { describe, expect, it } from 'vitest'
import { splitSafeLinks } from './safeLinks'

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
})
