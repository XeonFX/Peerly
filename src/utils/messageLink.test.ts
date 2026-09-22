// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildMessageLink, messageIdFromHash } from './messageLink'

describe('message links', () => {
  it('round-trips an opaque message id without replacing the current route', () => {
    const link = buildMessageLink('message / 1', 'https://preview.peerly.cc/workspace/Team/channel/general?files=1')
    expect(link).toBe('https://preview.peerly.cc/workspace/Team/channel/general?files=1#message=message%20%2F%201')
    expect(messageIdFromHash('#message=message%20%2F%201')).toBe('message / 1')
  })
})
