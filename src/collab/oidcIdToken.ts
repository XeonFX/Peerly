// Moved to @peerly/core so other apps can share it; re-exported here so
// existing imports keep working.
export {
  DEFAULT_EMAIL_VERIFIED_CLAIM,
  extractEmailClaim,
  resetOidcJwksCache,
  verifyOidcIdToken,
  type JwksFetcher,
  type JwkWithKid,
  type OidcIdTokenClaims,
  type VerifyOidcIdTokenOptions,
} from '@peerly/core'
