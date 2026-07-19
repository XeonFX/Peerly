/**
 * Phase logic for the ID-token lifetime.
 *
 * Tokens live about an hour. The reload path already handles "expired before
 * open" (session.loadIdToken), but a workspace kept open past expiry silently
 * loses the ability to admit anyone new — every fresh handshake presents a
 * dead token — while the connection UI keeps saying everything is fine. These
 * phases drive a banner that warns before that cliff and offers re-auth after.
 */

export type IdentityExpiryPhase = 'ok' | 'expiring' | 'expired'

/** Warn early enough to act, late enough not to nag: 5 minutes. */
export const EXPIRY_WARN_MS = 5 * 60_000

export function identityExpiryPhase(
  expiresAtMs: number | null,
  nowMs: number
): IdentityExpiryPhase {
  // No token at all (fresh tab / reload after expiry): sessions now outlive
  // tokens, so inside a workspace "no token" means "needs re-auth", not "ok".
  if (expiresAtMs === null) return 'expired'
  if (nowMs >= expiresAtMs) return 'expired'
  if (nowMs >= expiresAtMs - EXPIRY_WARN_MS) return 'expiring'
  return 'ok'
}

/** Delay until the phase can next change, or null when it never will. */
export function msUntilPhaseChange(expiresAtMs: number | null, nowMs: number): number | null {
  // null (no token) and Infinity (unreadable exp) never change phase on time.
  if (expiresAtMs === null || !Number.isFinite(expiresAtMs)) return null
  const boundary = nowMs < expiresAtMs - EXPIRY_WARN_MS ? expiresAtMs - EXPIRY_WARN_MS : expiresAtMs
  if (nowMs >= expiresAtMs) return null
  // Never fire early on timer drift: clamp to at least a second.
  return Math.max(1_000, boundary - nowMs)
}
