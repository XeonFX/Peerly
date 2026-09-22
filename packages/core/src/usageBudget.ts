/**
 * Daily free-tier budgets, and when to shout about them.
 *
 * Pure so it can be tested without a network: the worker fetches the numbers,
 * this decides what they mean. On 2026-08-02 a client bug spent 4.8x the daily
 * Worker allowance, 2.6x the Durable Object request allowance and 60x the
 * rows-read allowance in two hours, and the first anyone knew of it was a quota
 * email the following day. Everything here exists so that gap is minutes.
 */

/** Cloudflare's free-tier daily ceilings. */
export const FREE_TIER_DAILY = {
  workerRequests: 100_000,
  durableObjectRequests: 100_000,
  durableObjectRowsRead: 5_000_000,
} as const

export type UsageSample = {
  readonly workerRequests: number
  readonly durableObjectRequests: number
  readonly durableObjectRowsRead: number
}

export type BudgetLevel = 'ok' | 'notice' | 'warning' | 'critical' | 'exhausted'

export type BudgetFinding = {
  readonly metric: keyof UsageSample
  readonly used: number
  readonly limit: number
  readonly fraction: number
  readonly level: BudgetLevel
}

/**
 * Thresholds are deliberately low. The failing mode is not a slow climb toward
 * the ceiling — it is a runaway loop that covers the whole budget inside an
 * hour, so the only useful alert is one that fires while there is still budget
 * left to protect.
 */
const THRESHOLDS: readonly { readonly at: number; readonly level: BudgetLevel }[] = [
  { at: 1, level: 'exhausted' },
  { at: 0.8, level: 'critical' },
  { at: 0.5, level: 'warning' },
  { at: 0.25, level: 'notice' },
]

const METRIC_LIMIT: Record<keyof UsageSample, number> = {
  workerRequests: FREE_TIER_DAILY.workerRequests,
  durableObjectRequests: FREE_TIER_DAILY.durableObjectRequests,
  durableObjectRowsRead: FREE_TIER_DAILY.durableObjectRowsRead,
}

export function levelFor(fraction: number): BudgetLevel {
  for (const threshold of THRESHOLDS) {
    if (fraction >= threshold.at) return threshold.level
  }
  return 'ok'
}

/** Every metric, worst first, so a caller can report the headline and the rest. */
export function assess(sample: UsageSample): readonly BudgetFinding[] {
  return (Object.keys(METRIC_LIMIT) as (keyof UsageSample)[])
    .map(metric => {
      const limit = METRIC_LIMIT[metric]
      const used = Math.max(0, sample[metric])
      const fraction = limit === 0 ? 0 : used / limit
      return { metric, used, limit, fraction, level: levelFor(fraction) }
    })
    .sort((left, right) => right.fraction - left.fraction)
}

/**
 * Whether this reading deserves a notification.
 *
 * Only on a *rise*: a budget sitting at 60% all afternoon is one alert, not one
 * per check. Without this the watcher becomes the thing you mute, and a muted
 * alert is worse than none because it reads as coverage.
 */
export function shouldNotify(
  current: readonly BudgetFinding[],
  previousLevels: Partial<Record<keyof UsageSample, BudgetLevel>>
): boolean {
  const rank = (level: BudgetLevel): number =>
    ['ok', 'notice', 'warning', 'critical', 'exhausted'].indexOf(level)
  return current.some(finding => rank(finding.level) > rank(previousLevels[finding.metric] ?? 'ok'))
}

const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`

export function describe(findings: readonly BudgetFinding[], utcDate: string): string {
  const worst = findings[0]
  const lines = findings.map(finding =>
    `  ${finding.metric}: ${finding.used.toLocaleString('en-US')} / ` +
    `${finding.limit.toLocaleString('en-US')} (${percent(finding.fraction)}) — ${finding.level}`
  )
  return [
    `Cloudflare daily budget ${worst.level.toUpperCase()} for ${utcDate} (UTC)`,
    ...lines,
    'Budgets reset at 00:00 UTC.',
  ].join('\n')
}
