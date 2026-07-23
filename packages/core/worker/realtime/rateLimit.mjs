/**
 * Per-socket token bucket. Deliberately in-memory, not persisted: hibernation
 * evicting the bucket only ever refills tokens, never grants extra ones, so
 * it cannot be used to bypass the limit.
 */
export function createTokenBucket({ burst, sustainedPerSecond }) {
  let tokens = burst
  let lastRefill = Date.now()
  return {
    take(now = Date.now()) {
      const elapsedSeconds = Math.max(0, now - lastRefill) / 1000
      tokens = Math.min(burst, tokens + elapsedSeconds * sustainedPerSecond)
      lastRefill = now
      if (tokens < 1) return false
      tokens -= 1
      return true
    },
  }
}
