import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** What the tab notice says: another tab joined, the only other tab closed, or one of several closed. */
export type SiblingTabNotice = 'joined' | 'left' | 'one-left'

/** What the user reads for each notice (translated at render). */
export const TAB_NOTICE_TEXT: Record<SiblingTabNotice, string> = {
  joined:
    'This workspace is also open in another tab of this browser. Both tabs stay connected and in sync, and sounds and notifications play only once.',
  left: 'Your other tab closed. This tab is still connected.',
  'one-left': 'One of your other tabs closed. This tab is still connected.',
}

/**
 * A sibling that drops and comes back within this window reconnected (a network blip, its relay socket recycling, or
 * a reload that comes back as a new tab), and nothing is said about it.
 */
const LEAVE_GRACE_MS = 6_000
/** A notice goes away on its own after this long. */
const NOTICE_MS = 8_000

type Timers = {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * Which other tabs of this browser are connected to this workspace, and what – if anything – to tell the user about a
 * change. Pure bookkeeping, so the rules are testable without a room:
 *
 * - A tab seen for the first time: "joined".
 * - A tab that leaves: said only after `graceMs`, and not at all if it (or a replacement, i.e. the same tab reloaded)
 *   joins meanwhile.
 * - A tab seen before that joins again (this tab's own room reconnected, or the relay recycled): nothing.
 */
export class SiblingTabTracker {
  private readonly live = new Set<string>()
  private readonly seen = new Set<string>()
  private readonly pendingLeaves = new Map<string, unknown>()
  private readonly timers: Timers
  private readonly graceMs: number
  private readonly onChange: (count: number, notice: SiblingTabNotice | null) => void

  constructor(options: {
    onChange: (count: number, notice: SiblingTabNotice | null) => void
    graceMs?: number
    timers?: Timers
  }) {
    this.onChange = options.onChange
    this.graceMs = options.graceMs ?? LEAVE_GRACE_MS
    this.timers = options.timers ?? realTimers
  }

  get count(): number {
    return this.live.size + this.pendingLeaves.size
  }

  join(peerId: string): void {
    if (this.live.has(peerId)) return
    const pending = this.pendingLeaves.get(peerId)
    if (pending !== undefined) {
      this.timers.clear(pending)
      this.pendingLeaves.delete(peerId)
      this.live.add(peerId)
      return this.onChange(this.count, null)
    }
    // A different tab while one is on its way out: the same tab reloaded under a new peer id.
    const [replaced] = this.pendingLeaves.keys()
    if (replaced !== undefined) {
      this.timers.clear(this.pendingLeaves.get(replaced))
      this.pendingLeaves.delete(replaced)
      this.live.add(peerId)
      this.seen.add(peerId)
      return this.onChange(this.count, null)
    }
    const known = this.seen.has(peerId)
    this.live.add(peerId)
    this.seen.add(peerId)
    this.onChange(this.count, known ? null : 'joined')
  }

  leave(peerId: string): void {
    if (!this.live.delete(peerId)) return
    this.pendingLeaves.set(peerId, this.timers.set(() => {
      this.pendingLeaves.delete(peerId)
      this.onChange(this.count, this.count > 0 ? 'one-left' : 'left')
    }, this.graceMs))
  }

  /** A different workspace: forget everything, say nothing. */
  reset(): void {
    for (const handle of this.pendingLeaves.values()) this.timers.clear(handle)
    this.pendingLeaves.clear()
    this.live.clear()
    this.seen.clear()
    this.onChange(0, null)
  }
}

export function useSiblingTabs() {
  const [count, setCount] = useState(0)
  const [notice, setNotice] = useState<SiblingTabNotice | null>(null)
  const tracker = useMemo(
    () => new SiblingTabTracker({
      onChange: (nextCount, nextNotice) => {
        setCount(nextCount)
        // A reconnect says nothing, but must not hide a notice that is still showing.
        if (nextNotice) setNotice(nextNotice)
      },
    }),
    []
  )
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!notice) return
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    }
  }, [notice])

  useEffect(() => () => tracker.reset(), [tracker])

  const dismissNotice = useCallback(() => setNotice(null), [])
  const reset = useCallback(() => {
    tracker.reset()
    setNotice(null)
  }, [tracker])

  return {
    count,
    notice,
    dismissNotice,
    onJoin: useCallback((peerId: string) => tracker.join(peerId), [tracker]),
    onLeave: useCallback((peerId: string) => tracker.leave(peerId), [tracker]),
    reset,
  }
}
