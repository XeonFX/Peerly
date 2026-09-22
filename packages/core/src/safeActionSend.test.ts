import { describe, expect, it, vi } from 'vitest'
import { isExpectedActionSendError, sendActionSafely } from './safeActionSend.js'

describe('safe action sends', () => {
  it.each([
    'RTCDataChannel.readyState is not open',
    'data channel is closed',
    'peer disconnected before send',
    'no peer with id abc',
    'room already left',
  ])('recognises an expected disconnect race: %s', message => {
    expect(isExpectedActionSendError(new Error(message))).toBe(true)
  })

  it('suppresses expected disconnect races', async () => {
    const report = vi.fn()
    await expect(sendActionSafely(
      () => Promise.reject(new Error('RTCDataChannel.readyState is not open')),
      'typing',
      report
    )).resolves.toBe(false)
    expect(report).not.toHaveBeenCalled()
  })

  it('reports unexpected failures', async () => {
    const report = vi.fn()
    const failure = new Error('serialization failed')
    await expect(sendActionSafely(() => Promise.reject(failure), 'chat', report)).resolves.toBe(false)
    expect(report).toHaveBeenCalledWith('chat failed', failure)
  })

  it('also catches synchronous send failures', async () => {
    const report = vi.fn()
    await expect(sendActionSafely(() => {
      throw new Error('data channel is closing')
    }, 'profile', report)).resolves.toBe(false)
    expect(report).not.toHaveBeenCalled()
  })
})
