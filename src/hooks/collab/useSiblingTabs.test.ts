import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SiblingTabTracker, type SiblingTabNotice } from './useSiblingTabs'

function tracker() {
  const changes: Array<{ count: number; notice: SiblingTabNotice | null }> = []
  const instance = new SiblingTabTracker({
    graceMs: 1_000,
    onChange: (count, notice) => changes.push({ count, notice }),
  })
  const notices = () => changes.map(change => change.notice).filter(Boolean)
  const count = () => changes.at(-1)?.count ?? 0
  return { instance, changes, notices, count }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('sibling tab notices', () => {
  it('two tabs join: one notice for a tab seen for the first time', () => {
    const t = tracker()
    t.instance.join('tab-2')
    expect(t.notices()).toEqual(['joined'])
    expect(t.count()).toBe(1)
    t.instance.join('tab-2')
    expect(t.notices()).toEqual(['joined'])
  })

  it('one closes: said once, after the grace period', () => {
    const t = tracker()
    t.instance.join('tab-2')
    t.instance.leave('tab-2')
    expect(t.notices()).toEqual(['joined'])
    expect(t.instance.count).toBe(1)
    vi.advanceTimersByTime(1_000)
    expect(t.notices()).toEqual(['joined', 'left'])
    expect(t.count()).toBe(0)
  })

  it('one of several closes: says that one closed and others remain', () => {
    const t = tracker()
    t.instance.join('tab-2')
    t.instance.join('tab-3')
    t.instance.leave('tab-3')
    vi.advanceTimersByTime(1_000)
    expect(t.notices()).toEqual(['joined', 'joined', 'one-left'])
    expect(t.count()).toBe(1)
  })

  it('both reconnect: a drop and return within the grace period says nothing', () => {
    const t = tracker()
    t.instance.join('tab-2')
    t.instance.leave('tab-2')
    vi.advanceTimersByTime(500)
    t.instance.join('tab-2')
    vi.advanceTimersByTime(5_000)
    expect(t.notices()).toEqual(['joined'])
    expect(t.count()).toBe(1)
  })

  it('a known tab returning after this tab rebuilt its room says nothing', () => {
    const t = tracker()
    t.instance.join('tab-2')
    t.instance.leave('tab-2')
    vi.advanceTimersByTime(1_000)
    t.instance.join('tab-2')
    expect(t.notices()).toEqual(['joined', 'left'])
  })

  it('a reloaded tab (it leaves, a new tab id joins) is a replacement, not a leave and a join', () => {
    const t = tracker()
    t.instance.join('tab-2')
    t.instance.leave('tab-2')
    t.instance.join('tab-2-reloaded')
    vi.advanceTimersByTime(5_000)
    expect(t.notices()).toEqual(['joined'])
    expect(t.count()).toBe(1)
  })

  it('a stale leave for a tab never seen joining is ignored', () => {
    const t = tracker()
    t.instance.leave('ghost')
    vi.advanceTimersByTime(5_000)
    expect(t.changes).toEqual([])
  })

  it('switching workspace forgets every tab and cancels pending notices', () => {
    const t = tracker()
    t.instance.join('tab-2')
    t.instance.leave('tab-2')
    t.instance.reset()
    vi.advanceTimersByTime(5_000)
    expect(t.notices()).toEqual(['joined'])
    expect(t.count()).toBe(0)
    t.instance.join('tab-2')
    expect(t.notices()).toEqual(['joined', 'joined'])
  })
})
