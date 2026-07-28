export const DEFAULT_CREDENTIAL_RENEW_BEFORE_MS = 5 * 60_000
export const DEFAULT_CREDENTIAL_RETRY_MS = 60_000

export type CredentialRenewalPolicy = {
  renewBeforeMs?: number
  retryMs?: number
}

function nonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function credentialRenewalDelay(
  expiresAt: number | null,
  now = Date.now(),
  policy: CredentialRenewalPolicy = {}
): number {
  if (expiresAt === null) return 0
  const renewBeforeMs = nonNegative(
    policy.renewBeforeMs ?? DEFAULT_CREDENTIAL_RENEW_BEFORE_MS,
    DEFAULT_CREDENTIAL_RENEW_BEFORE_MS
  )
  return Math.max(0, expiresAt - now - renewBeforeMs)
}

export function credentialRetryDelay(
  expiresAt: number | null,
  now = Date.now(),
  policy: CredentialRenewalPolicy = {}
): number | null {
  const retryMs = nonNegative(
    policy.retryMs ?? DEFAULT_CREDENTIAL_RETRY_MS,
    DEFAULT_CREDENTIAL_RETRY_MS
  )
  if (expiresAt === null) return retryMs
  const remaining = expiresAt - now
  return remaining > 0 ? Math.min(retryMs, remaining) : null
}

export function credentialNeedsRenewal(
  expiresAt: number | null,
  now = Date.now(),
  policy: CredentialRenewalPolicy = {}
): boolean {
  return credentialRenewalDelay(expiresAt, now, policy) === 0
}
