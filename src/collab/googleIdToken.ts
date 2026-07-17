// Moved to @peerly/core so other apps share Google's pinned issuers and JWKS;
// re-exported here so existing imports keep working.
export {
  resetGoogleJwksCache as resetJwksCache,
  verifyGoogleIdToken,
  type GoogleIdTokenClaims,
} from '@peerly/core'
export type { JwkWithKid, JwksFetcher, VerifyGoogleIdTokenOptions as VerifyIdTokenOptions } from '@peerly/core'
