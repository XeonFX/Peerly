// Moved to @peerly/core so HeyHubs and other apps share it; re-exported here so
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
