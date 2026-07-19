/**
 * Single source of truth for the identifiable data controller and contacts the
 * Privacy Policy and Terms must name (GDPR Art. 13(1)(a)). Edit here and every
 * legal surface (docs pages, consent banner, footer links) follows.
 */
export const legalMeta = {
  /** Natural person operating Peerly (sole operator / individual controller). */
  controller: 'Krystian Pawłow',
  /** Country of establishment — sets the supervisory authority (PL: UODO). */
  country: 'Poland',
  supervisoryAuthority: 'the President of the Personal Data Protection Office (UODO), Poland',
  /** Privacy / data-subject requests (access, deletion, objection). */
  privacyEmail: 'privacy@peerly.cc',
  /** Abuse / illegal-content reports (DSA notice-and-action). */
  abuseEmail: 'abuse@peerly.cc',
  /** Governing law for the Terms. */
  governingLaw: 'Poland',
  /** Minimum age to use the app. Peerly is invite-only team collaboration. */
  minAge: 16,
  /** Last substantive update to the legal texts (ISO date). */
  lastUpdated: '2026-07-19',
} as const
