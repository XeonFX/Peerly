import { describe, expect, it } from 'vitest'
import { encodeCanonicalLines } from './canonical.js'

describe('encodeCanonicalLines', () => {
  it('joins with newlines and keeps free text last stable', () => {
    const a = encodeCanonicalLines(['scheme', 'id', 'hello\nworld'])
    const b = encodeCanonicalLines(['scheme', 'id', 'hello\nworld'])
    expect(a).toEqual(b)
    expect(new TextDecoder().decode(a)).toBe('scheme\nid\nhello\nworld')
  })
})
