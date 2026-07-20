/**
 * Records that the user has agreed to the current Terms + Privacy Policy.
 * Versioned: bump LEGAL_VERSION when the legal texts change materially and every
 * user is re-prompted on their next visit. Lightweight localStorage record —
 * appropriate for a serverless app with no account database.
 */
export const LEGAL_VERSION = 2

/** localStorage key — shared with e2e so tests can seed acceptance. */
export const LEGAL_CONSENT_STORAGE_KEY = 'peerly-legal-consent-v1'

const STORAGE_KEY = LEGAL_CONSENT_STORAGE_KEY

type StoredConsent = { version: number; acceptedAt: number }

export function acceptedLegalVersion(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as Partial<StoredConsent>
    return typeof parsed.version === 'number' ? parsed.version : 0
  } catch {
    return 0
  }
}

export function hasAcceptedCurrentLegal(): boolean {
  return acceptedLegalVersion() >= LEGAL_VERSION
}

export function acceptCurrentLegal(): void {
  const payload: StoredConsent = { version: LEGAL_VERSION, acceptedAt: Date.now() }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage blocked (private mode) — banner reappears next load; nowhere else
    // to record consent in a serverless design.
  }
}
