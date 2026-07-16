/** Increasing backoff after clean frames keeps long calls responsive. */
export function videoScreeningDelay(cleanRuns: number): number {
  if (cleanRuns < 5) return 3_000
  if (cleanRuns < 10) return 10_000
  return 30_000
}
