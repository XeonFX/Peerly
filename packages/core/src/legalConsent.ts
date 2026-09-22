/**
 * Recording that a user has agreed to the current Terms and Privacy Policy.
 *
 * Versioned: raise the version when the texts change materially and every user
 * is re-prompted on their next visit. A lightweight, honour-system record in
 * localStorage — the right weight for a serverless app with no account
 * database to store consent against, and the reason nothing here treats the
 * record as evidence of anything.
 *
 * Reading fails to 0 — never accepted — for every reason it can fail. An
 * unreadable record has to mean "ask again", because the alternative is
 * treating a corrupted value as agreement.
 */
export type LegalConsentConfig = {
  /** Raise to re-prompt everyone. */
  readonly version: number
  readonly storageKey: string
}

export type LegalConsent = {
  /** The version this browser last accepted; 0 if none, or if unreadable. */
  acceptedVersion(): number
  hasAcceptedCurrent(): boolean
  acceptCurrent(): void
}

type StoredConsent = {
  version: number
  acceptedAt: number
}

export function createLegalConsent(config: LegalConsentConfig): LegalConsent {
  function acceptedVersion(): number {
    try {
      const raw = localStorage.getItem(config.storageKey)
      if (!raw) return 0
      const parsed = JSON.parse(raw) as Partial<StoredConsent>
      return typeof parsed.version === 'number' ? parsed.version : 0
    } catch {
      return 0
    }
  }

  return {
    acceptedVersion,
    hasAcceptedCurrent: () => acceptedVersion() >= config.version,

    acceptCurrent() {
      const payload: StoredConsent = { version: config.version, acceptedAt: Date.now() }
      try {
        localStorage.setItem(config.storageKey, JSON.stringify(payload))
      } catch {
        // Storage blocked, as in private mode. The banner reappears next load,
        // which is the honest outcome: there is nowhere else to record this.
      }
    },
  }
}
