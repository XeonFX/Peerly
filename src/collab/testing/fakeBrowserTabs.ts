import { BrowserTabs, type BrowserTabsOptions, type ChannelLike, type LocksLike } from '../browserTabs'

/**
 * One simulated browser profile for tests: a BroadcastChannel hub that delivers to every other channel asynchronously
 * (structured-cloned, as the real one does) and a Web Locks manager whose locks are shared by all its tabs.
 */
export function fakeBrowser() {
  const channels = new Set<ChannelLike>()
  const held = new Set<string>()
  const waiting = new Map<string, Array<() => void>>()

  const channel = (): ChannelLike => {
    const self: ChannelLike = {
      onmessage: null,
      postMessage: message => {
        const copy = structuredClone(message)
        for (const other of channels) {
          if (other !== self) setTimeout(() => other.onmessage?.({ data: copy }), 0)
        }
      },
      close: () => {
        channels.delete(self)
      },
    }
    channels.add(self)
    return self
  }

  const release = (name: string) => {
    held.delete(name)
    const next = waiting.get(name)?.shift()
    next?.()
  }

  const locks: LocksLike & { forceRelease: (name: string) => void; held: Set<string> } = {
    held,
    request: (name, options, callback) => new Promise((resolve, reject) => {
      const grant = () => {
        held.add(name)
        Promise.resolve()
          .then(() => callback({ name }))
          .then(resolve, reject)
          .finally(() => { if (held.has(name)) release(name) })
      }
      if (!held.has(name)) return grant()
      if (options.ifAvailable) {
        return Promise.resolve().then(() => callback(null)).then(resolve, reject)
      }
      const queue = waiting.get(name) ?? []
      queue.push(grant)
      waiting.set(name, queue)
    }),
    query: async () => ({ held: [...held].map(name => ({ name })) }),
    /** The browser dropping a lock without the page's say-so: the tab crashed or was discarded. */
    forceRelease: name => release(name),
  }

  const tab = (options: BrowserTabsOptions = {}) =>
    new BrowserTabs({ channel: channel(), locks, replyTimeoutMs: 200, claimHoldMs: 50, hiddenClaimDelayMs: 20, ...options })

  return { tab, locks }
}
