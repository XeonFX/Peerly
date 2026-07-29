/**
 * Records that the user has agreed to the current Terms + Privacy Policy.
 *
 * The record itself lives in `@peerly/core`; what is this app's is the version
 * — bump it when the legal texts change materially and every user is
 * re-prompted on their next visit.
 */
import { createLegalConsent } from '@peerly/core'

export const LEGAL_VERSION = 4

/**
 * Exported so e2e can seed acceptance rather than click through the banner.
 *
 * Spelled out rather than built from the app's storage scope: the e2e helpers
 * import this from Node, and reaching for that constant pulls in `config.ts`
 * and the build-time globals it depends on, which only exist inside Vite. The
 * key is frozen regardless, so composing it bought nothing.
 */
export const LEGAL_CONSENT_STORAGE_KEY = 'peerly-legal-consent-v1'

const consent = createLegalConsent({
  version: LEGAL_VERSION,
  storageKey: LEGAL_CONSENT_STORAGE_KEY,
})

export const acceptedLegalVersion = consent.acceptedVersion
export const hasAcceptedCurrentLegal = consent.hasAcceptedCurrent
export const acceptCurrentLegal = consent.acceptCurrent
