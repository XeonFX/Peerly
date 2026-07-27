/**
 * Records that the user has agreed to the current Terms + Privacy Policy.
 *
 * The record itself lives in `@peerly/core`; what is this app's is the version
 * — bump it when the legal texts change materially and every user is
 * re-prompted on their next visit.
 */
import { createLegalConsent } from '@peerly/core'
import { APP_STORAGE_SCOPE } from './config'

export const LEGAL_VERSION = 3

/** Exported so e2e can seed acceptance rather than click through the banner. */
export const LEGAL_CONSENT_STORAGE_KEY = `${APP_STORAGE_SCOPE}-legal-consent-v1`

const consent = createLegalConsent({
  version: LEGAL_VERSION,
  storageKey: LEGAL_CONSENT_STORAGE_KEY,
})

export const acceptedLegalVersion = consent.acceptedVersion
export const hasAcceptedCurrentLegal = consent.hasAcceptedCurrent
export const acceptCurrentLegal = consent.acceptCurrent
