import { describe, expect, it } from 'vitest'
import {
  assess, describe as describeBudget, FREE_TIER_DAILY, levelFor, shouldNotify,
} from './usageBudget.js'

/**
 * The numbers here are the real ones from 2026-08-02, because the point of this
 * module is that nobody noticed them for twelve hours.
 */
const THAT_DAY = {
  workerRequests: 483_180,
  durableObjectRequests: 264_600,
  durableObjectRowsRead: 300_018_783,
}

describe('budget levels', () => {
  it('stays quiet well below the ceiling', () => {
    expect(levelFor(0)).toBe('ok')
    expect(levelFor(0.24)).toBe('ok')
  })

  it('escalates through notice, warning and critical', () => {
    expect(levelFor(0.25)).toBe('notice')
    expect(levelFor(0.5)).toBe('warning')
    expect(levelFor(0.8)).toBe('critical')
  })

  it('calls a spent budget exhausted, not merely critical', () => {
    expect(levelFor(1)).toBe('exhausted')
    expect(levelFor(60)).toBe('exhausted')
  })
})

describe('assessment', () => {
  it('ranks the worst metric first, which is the one worth reporting', () => {
    const findings = assess(THAT_DAY)
    expect(findings[0].metric).toBe('durableObjectRowsRead')
    expect(findings[0].level).toBe('exhausted')
    // 300M against a 5M ceiling.
    expect(findings[0].fraction).toBeGreaterThan(59)
  })

  it('reports every metric, not just the worst', () => {
    expect(assess(THAT_DAY).map(f => f.metric).sort()).toEqual([
      'durableObjectRequests', 'durableObjectRowsRead', 'workerRequests',
    ])
  })

  it('is quiet on an ordinary day', () => {
    const findings = assess({
      workerRequests: 900, durableObjectRequests: 700, durableObjectRowsRead: 40_000,
    })
    expect(findings.every(finding => finding.level === 'ok')).toBe(true)
  })

  /**
   * The storm reached 98,946 Worker requests in its first hour. An alert that
   * only fired at the ceiling would have been useless; this is the check that
   * it fires with budget left to protect.
   */
  it('would have fired within the first hour of the incident', () => {
    const firstHour = assess({
      workerRequests: 98_946, durableObjectRequests: 161_800, durableObjectRowsRead: 300_008_684,
    })
    expect(firstHour[0].level).toBe('exhausted')
    expect(firstHour.find(f => f.metric === 'workerRequests')?.level).toBe('critical')
  })

  it('treats a negative reading as zero rather than trusting it', () => {
    const findings = assess({
      workerRequests: -5, durableObjectRequests: 0, durableObjectRowsRead: 0,
    })
    expect(findings.every(finding => finding.used === 0)).toBe(true)
  })
})

describe('notification suppression', () => {
  const findings = assess({
    workerRequests: FREE_TIER_DAILY.workerRequests * 0.6,
    durableObjectRequests: 0,
    durableObjectRowsRead: 0,
  })

  it('notifies when a metric rises into a new level', () => {
    expect(shouldNotify(findings, { workerRequests: 'notice' })).toBe(true)
  })

  /** A budget parked at 60% is one alert, not one every fifteen minutes. An
   *  alert you mute is worse than none, because it reads as coverage. */
  it('stays silent while a metric sits at the level it already reported', () => {
    expect(shouldNotify(findings, { workerRequests: 'warning' })).toBe(false)
  })

  it('stays silent when usage falls back', () => {
    expect(shouldNotify(findings, { workerRequests: 'critical' })).toBe(false)
  })

  it('notifies on a first reading above ok, with nothing remembered', () => {
    expect(shouldNotify(findings, {})).toBe(true)
  })
})

describe('message', () => {
  it('leads with the worst level and names the reset', () => {
    const message = describeBudget(assess(THAT_DAY), '2026-08-02')
    expect(message).toContain('EXHAUSTED')
    expect(message).toContain('2026-08-02')
    expect(message).toContain('durableObjectRowsRead')
    expect(message).toContain('300,018,783')
    expect(message).toContain('00:00 UTC')
  })
})
