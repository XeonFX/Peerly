/**
 * The other open tabs of this browser profile, as far as this tab can see them.
 *
 * Every tab of one profile holds the same device key, so the handshake tells them apart by tab key (see
 * `@peerly/core` tabSession.ts). This module is the local half of that: a peer that presents this device's own key is
 * admitted only if a tab here answers for its tab key (`hasSibling`). Only same-origin pages of this profile can post
 * on the BroadcastChannel – which is also all that can use the device key – so a remote peer cannot answer for a tab.
 *
 * It also makes attention happen once per browser rather than once per tab: a chime, a ringtone or an OS
 * notification is presented by whichever tab claims its key first (`claim`), and a call answered or declined in one
 * tab stops ringing in the others (`announceHandled`).
 *
 * Liveness comes from Web Locks, not heartbeats: each tab holds `peerly-tab:<id>` for as long as it lives, and the
 * browser releases it when the tab closes or crashes. Heartbeats would be throttled in background tabs – exactly the
 * tabs that need to notify – and make a sleeping tab look dead. Without Web Locks every reply is taken at face value
 * and a claim is first-come by broadcast, which can rarely double a chime but never drop one.
 */

const CHANNEL_NAME = 'peerly-tabs'
const LIFE_LOCK_PREFIX = 'peerly-tab:'
const CLAIM_LOCK_PREFIX = 'peerly-attention:'
/** How long a tab waits for another tab to answer for a tab key. Same-profile tabs answer within milliseconds. */
const SIBLING_REPLY_TIMEOUT_MS = 1_500
/** A claim's lock is held this long, so a tab receiving the same event a moment later finds it taken. */
const CLAIM_HOLD_MS = 3_000
/** Remember presented keys this long, for a tab that receives the same event late (e.g. after a reconnect). */
const PRESENTED_TTL_MS = 10 * 60_000
/** A hidden tab waits this long before claiming something a visible tab would rather present. */
const HIDDEN_CLAIM_DELAY_MS = 250

type Message =
  | { t: 'who'; reqId: string; tabKeyId: string; from: string }
  | { t: 'me'; reqId: string; from: string }
  | { t: 'claimed'; key: string; from: string }
  | { t: 'handled'; key: string; from: string }

export type ChannelLike = {
  postMessage: (message: unknown) => void
  onmessage: ((event: { data: unknown }) => void) | null
  close: () => void
}

export type LocksLike = {
  request: (
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown) => unknown
  ) => Promise<unknown>
  query: () => Promise<{ held?: Array<{ name?: string }> }>
}

export type BrowserTabsOptions = {
  channel?: ChannelLike | null
  locks?: LocksLike | null
  isVisible?: () => boolean
  now?: () => number
  tabId?: string
  replyTimeoutMs?: number
  claimHoldMs?: number
  hiddenClaimDelayMs?: number
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function isMessage(data: unknown): data is Message {
  if (!data || typeof data !== 'object') return false
  const m = data as Record<string, unknown>
  if (typeof m.from !== 'string') return false
  switch (m.t) {
    case 'who': return typeof m.reqId === 'string' && typeof m.tabKeyId === 'string'
    case 'me': return typeof m.reqId === 'string'
    case 'claimed':
    case 'handled': return typeof m.key === 'string'
    default: return false
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export class BrowserTabs {
  readonly tabId: string
  private readonly channel: ChannelLike | null
  private readonly locks: LocksLike | null
  private readonly isVisible: () => boolean
  private readonly now: () => number
  private readonly replyTimeoutMs: number
  private readonly claimHoldMs: number
  private readonly hiddenClaimDelayMs: number
  private readonly ownTabKeys = new Set<string>()
  private readonly pendingWho = new Map<string, (from: string) => void>()
  private readonly presented = new Map<string, number>()
  /** Keys this tab claimed: asking again (a re-render restarting a ringtone) keeps them here. */
  private readonly claimedHere = new Set<string>()
  private readonly handledListeners = new Set<(key: string) => void>()
  private releaseLife: (() => void) | null = null
  private closed = false

  constructor(options: BrowserTabsOptions = {}) {
    this.tabId = options.tabId ?? randomId()
    this.channel = options.channel === undefined ? defaultChannel() : options.channel
    this.locks = options.locks === undefined ? defaultLocks() : options.locks
    this.isVisible = options.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible')
    this.now = options.now ?? Date.now
    this.replyTimeoutMs = options.replyTimeoutMs ?? SIBLING_REPLY_TIMEOUT_MS
    this.claimHoldMs = options.claimHoldMs ?? CLAIM_HOLD_MS
    this.hiddenClaimDelayMs = options.hiddenClaimDelayMs ?? HIDDEN_CLAIM_DELAY_MS
    if (this.channel) this.channel.onmessage = event => this.receive(event.data)
    if (this.locks) {
      void this.locks.request(`${LIFE_LOCK_PREFIX}${this.tabId}`, {}, () =>
        new Promise<void>(resolve => { this.releaseLife = resolve })
      ).catch(() => {})
    }
  }

  /** A tab key this tab holds; other tabs asking about it get an answer. */
  addOwnTabKey(tabKeyId: string): void {
    this.ownTabKeys.add(tabKeyId)
  }

  /** Whether another live tab of this browser holds `tabKeyId`. False when no tab answers in time. */
  async hasSibling(tabKeyId: string): Promise<boolean> {
    if (!this.channel || this.closed) return false
    const reqId = randomId()
    const from = await new Promise<string | null>(resolve => {
      const timer = setTimeout(() => {
        this.pendingWho.delete(reqId)
        resolve(null)
      }, this.replyTimeoutMs)
      this.pendingWho.set(reqId, replier => {
        clearTimeout(timer)
        this.pendingWho.delete(reqId)
        resolve(replier)
      })
      this.post({ t: 'who', reqId, tabKeyId, from: this.tabId })
    })
    // `receive` drops this tab's own messages, so a reply always comes from another tab.
    if (!from) return false
    // A reply from a tab whose life lock is gone is a stale tab, not a sibling.
    return this.isAlive(from)
  }

  /**
   * Whether this tab should present the attention event `key` (a chime, a ringtone, an OS notification). True for
   * exactly one tab of the browser per key; every other tab gets false and stays quiet.
   */
  async claim(key: string, options: { preferVisible?: boolean } = {}): Promise<boolean> {
    if (this.closed) return true
    if (options.preferVisible && !this.isVisible()) await sleep(this.hiddenClaimDelayMs)
    this.prunePresented()
    if (this.claimedHere.has(key)) return true
    if (this.presented.has(key)) return false
    if (!this.locks) {
      this.markPresented(key, true)
      this.claimedHere.add(key)
      return true
    }
    return new Promise<boolean>(resolve => {
      this.locks!.request(`${CLAIM_LOCK_PREFIX}${key}`, { ifAvailable: true }, lock => {
        if (!lock || this.presented.has(key)) {
          resolve(false)
          return undefined
        }
        this.markPresented(key, true)
        this.claimedHere.add(key)
        resolve(true)
        return sleep(this.claimHoldMs)
      }).catch(() => resolve(false))
    })
  }

  /** Tell the other tabs that `key` (e.g. an incoming call) was dealt with here. */
  announceHandled(key: string): void {
    this.claimedHere.delete(key)
    this.markPresented(key, false)
    this.post({ t: 'handled', key, from: this.tabId })
  }

  onHandled(listener: (key: string) => void): () => void {
    this.handledListeners.add(listener)
    return () => this.handledListeners.delete(listener)
  }

  close(): void {
    this.closed = true
    this.releaseLife?.()
    for (const resolve of this.pendingWho.values()) resolve('')
    this.pendingWho.clear()
    this.channel?.close()
  }

  private async isAlive(tabId: string): Promise<boolean> {
    if (!this.locks) return true
    try {
      const { held = [] } = await this.locks.query()
      return held.some(lock => lock.name === `${LIFE_LOCK_PREFIX}${tabId}`)
    } catch {
      return false
    }
  }

  private markPresented(key: string, broadcast: boolean): void {
    this.presented.set(key, this.now())
    if (broadcast) this.post({ t: 'claimed', key, from: this.tabId })
  }

  private prunePresented(): void {
    const cutoff = this.now() - PRESENTED_TTL_MS
    for (const [key, at] of this.presented) {
      if (at >= cutoff) continue
      this.presented.delete(key)
      this.claimedHere.delete(key)
    }
  }

  private post(message: Message): void {
    if (this.closed) return
    try {
      this.channel?.postMessage(message)
    } catch {
      // A closed or unavailable channel: this tab simply sees no siblings.
    }
  }

  private receive(data: unknown): void {
    if (this.closed || !isMessage(data) || data.from === this.tabId) return
    switch (data.t) {
      case 'who':
        if (this.ownTabKeys.has(data.tabKeyId)) this.post({ t: 'me', reqId: data.reqId, from: this.tabId })
        return
      case 'me':
        this.pendingWho.get(data.reqId)?.(data.from)
        return
      case 'claimed':
        this.presented.set(data.key, this.now())
        return
      case 'handled':
        this.claimedHere.delete(data.key)
        this.presented.set(data.key, this.now())
        for (const listener of this.handledListeners) listener(data.key)
    }
  }
}

function defaultChannel(): ChannelLike | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(CHANNEL_NAME) as unknown as ChannelLike)
  } catch {
    return null
  }
}

function defaultLocks(): LocksLike | null {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as { locks?: LocksLike }).locks
  return locks && typeof locks.request === 'function' && typeof locks.query === 'function' ? locks : null
}

let pageTabs: BrowserTabs | null = null

/** This page's view of its sibling tabs; one per page load. */
export function browserTabs(): BrowserTabs {
  pageTabs ??= new BrowserTabs()
  return pageTabs
}
