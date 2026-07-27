import { describe, expect, it } from 'vitest'
import { shouldRaiseNotification, type AttentionContext } from './attentionPolicy'

const allowed: AttentionContext = {
  visibility: 'hidden',
  enabled: true,
  supported: true,
  permission: 'granted',
}

describe('shouldRaiseNotification', () => {
  it('raises one when the tab is not being looked at', () => {
    expect(shouldRaiseNotification(allowed)).toBe(true)
  })

  it('never raises one for a tab in front of the user', () => {
    // The in-app banner has already told them. A second alert for something
    // on screen is what makes people turn notifications off for good.
    expect(shouldRaiseNotification({ ...allowed, visibility: 'visible' })).toBe(false)
  })

  it('respects the preference', () => {
    expect(shouldRaiseNotification({ ...allowed, enabled: false })).toBe(false)
  })

  it('stays quiet where the browser has no notifications', () => {
    expect(shouldRaiseNotification({ ...allowed, supported: false })).toBe(false)
  })

  it.each(['default', 'denied'])('does not raise one on permission %s', permission => {
    // `default` means never asked. Treating it as granted would throw, and
    // asking unprompted is worse than staying quiet.
    expect(shouldRaiseNotification({ ...allowed, permission })).toBe(false)
  })
})
