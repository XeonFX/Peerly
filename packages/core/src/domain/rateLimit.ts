/**
 * Token bucket, as a value rather than a closure over mutable state.
 *
 * `take` returns the next bucket alongside the decision, so a caller can hold
 * buckets in a map, in an attachment, or nowhere at all without the bucket
 * caring. The previous implementation closed over `let tokens`, which made it
 * impossible to test refill behaviour without also testing the clock.
 *
 * Deliberately not persisted: an evicted bucket only ever refills tokens, so
 * losing one to hibernation cannot grant extra allowance.
 */
export type Bucket = {
  readonly tokens: number
  readonly lastRefillMs: number
}

export type BucketPolicy = {
  /** Tokens available after an idle period — the size of an allowed burst. */
  readonly burst: number
  /** Long-run refill rate. */
  readonly sustainedPerSecond: number
}

export function createBucket(policy: BucketPolicy, nowMs: number): Bucket {
  return { tokens: policy.burst, lastRefillMs: nowMs }
}

export type TakeResult = {
  readonly allowed: boolean
  readonly bucket: Bucket
  /** How long until one token is available, for a `retryAfterMs` hint. */
  readonly retryAfterMs: number
}

export function take(bucket: Bucket, policy: BucketPolicy, nowMs: number): TakeResult {
  // A clock that jumps backwards must not mint tokens.
  const elapsedSeconds = Math.max(0, nowMs - bucket.lastRefillMs) / 1000
  const refilled = Math.min(policy.burst, bucket.tokens + elapsedSeconds * policy.sustainedPerSecond)

  if (refilled < 1) {
    const deficit = 1 - refilled
    return {
      allowed: false,
      bucket: { tokens: refilled, lastRefillMs: nowMs },
      retryAfterMs: Math.ceil((deficit / policy.sustainedPerSecond) * 1000),
    }
  }
  return {
    allowed: true,
    bucket: { tokens: refilled - 1, lastRefillMs: nowMs },
    retryAfterMs: 0,
  }
}
