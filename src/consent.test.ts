/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { LEGAL_VERSION, acceptCurrentLegal, acceptedLegalVersion, hasAcceptedCurrentLegal } from './consent'

afterEach(() => localStorage.clear())

describe('legal consent', () => {
  it('starts unaccepted', () => {
    expect(hasAcceptedCurrentLegal()).toBe(false)
    expect(acceptedLegalVersion()).toBe(0)
  })

  it('records the current version on accept', () => {
    acceptCurrentLegal()
    expect(acceptedLegalVersion()).toBe(LEGAL_VERSION)
    expect(hasAcceptedCurrentLegal()).toBe(true)
  })

  it('re-prompts when a newer version supersedes a stored one', () => {
    localStorage.setItem('peerly-legal-consent-v1', JSON.stringify({ version: LEGAL_VERSION - 1, acceptedAt: Date.now() }))
    expect(hasAcceptedCurrentLegal()).toBe(false)
  })

  it('treats corrupt storage as not accepted', () => {
    localStorage.setItem('peerly-legal-consent-v1', 'not json')
    expect(hasAcceptedCurrentLegal()).toBe(false)
  })
})
