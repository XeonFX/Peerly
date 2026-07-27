import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLegalConsent } from './legalConsent.js'

const config = { version: 3, storageKey: 'test-legal-consent' }

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
  })
})

describe('createLegalConsent', () => {
  it('starts un-accepted', () => {
    const consent = createLegalConsent(config)
    expect(consent.acceptedVersion()).toBe(0)
    expect(consent.hasAcceptedCurrent()).toBe(false)
  })

  it('records and reports acceptance', () => {
    const consent = createLegalConsent(config)
    consent.acceptCurrent()
    expect(consent.acceptedVersion()).toBe(3)
    expect(consent.hasAcceptedCurrent()).toBe(true)
  })

  it('re-prompts when the texts change materially', () => {
    createLegalConsent(config).acceptCurrent()
    expect(createLegalConsent({ ...config, version: 4 }).hasAcceptedCurrent()).toBe(false)
  })

  it('still honours a later acceptance than the one asked about', () => {
    createLegalConsent({ ...config, version: 5 }).acceptCurrent()
    expect(createLegalConsent(config).hasAcceptedCurrent()).toBe(true)
  })

  it('treats an unreadable record as never accepted', () => {
    // Every failure has to fall this way. Reading a corrupted value as
    // agreement is the one outcome that cannot be allowed.
    localStorage.setItem(config.storageKey, 'not json')
    expect(createLegalConsent(config).acceptedVersion()).toBe(0)
    localStorage.setItem(config.storageKey, '{"version":"three"}')
    expect(createLegalConsent(config).acceptedVersion()).toBe(0)
  })

  it('survives storage being blocked entirely', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    const consent = createLegalConsent(config)
    expect(() => consent.acceptCurrent()).not.toThrow()
    expect(consent.hasAcceptedCurrent()).toBe(false)
  })
})
