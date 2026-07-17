import { createEvent } from '@trystero-p2p/nostr'

/**
 * End-to-end health probe for a Nostr signaling relay.
 *
 * An open WebSocket is not health: several public relays keep the socket
 * alive and then refuse the ephemeral events Trystero signals with (proof-of-
 * work demands, web-of-trust gates, NIP-05 requirements). To a socket count
 * they look connected while carrying nothing. So this does what the app does —
 * subscribe, publish, and require the event to come back — and captures the
 * relay's own rejection reason when it doesn't.
 *
 * Same protocol as Peerly's `npm run check:relays`, usable in the browser.
 * Each probe opens two short-lived sockets per relay; call it on demand
 * (a diagnostics panel, a re-check button), not on a tight interval —
 * public relays throttle exactly that.
 */

export type RelayProbeResult = {
  url: string
  ok: boolean
  /** Round-trip publish→echo time for healthy relays. */
  ms?: number
  /** The relay's rejection reason / failure mode when not ok. */
  detail?: string
}

const strToNum = (str: string, limit: number) =>
  str.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % limit
/** Must match Trystero's topic→kind derivation so relays treat the probe like real traffic. */
const topicToKind = (topic: string) => strToNum(topic, 1e4) + 2e4

const DEFAULT_TIMEOUT_MS = 12_000

export function probeNostrRelay(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RelayProbeResult> {
  const topic = 'health-' + Math.random().toString(36).slice(2)
  const kind = topicToKind(topic)

  return new Promise(resolve => {
    const result: RelayProbeResult = { url, ok: false }
    const started = Date.now()
    let sub: WebSocket | undefined
    let pub: WebSocket | undefined
    let settled = false

    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        sub?.close()
        pub?.close()
      } catch {
        // already closing
      }
      resolve(result)
    }
    const timer = setTimeout(() => {
      result.detail ??= `timeout after ${Math.round(timeoutMs / 1000)}s`
      done()
    }, timeoutMs)

    try {
      sub = new WebSocket(url)
    } catch (err) {
      result.detail = `could not connect: ${err instanceof Error ? err.message : String(err)}`
      return done()
    }

    let opened = false
    sub.onerror = () => {
      result.detail ??= 'socket error'
    }
    sub.onclose = event => {
      if (!opened) {
        result.detail ??= `closed before open (code ${event.code})`
        done()
      }
    }
    sub.onopen = async () => {
      opened = true
      sub!.send(
        JSON.stringify(['REQ', 'h', { kinds: [kind], since: Math.floor(Date.now() / 1000) - 5 }])
      )
      // Give the subscription a moment to register before publishing.
      await new Promise(r => setTimeout(r, 600))
      if (settled) return
      pub = new WebSocket(url)
      pub.onerror = () => {}
      pub.onopen = async () => pub!.send(await createEvent(topic, 'ping'))
      pub.onmessage = event => {
        const msg = JSON.parse(String(event.data)) as [string, unknown, unknown, unknown?]
        if (msg[0] === 'OK' && msg[2] === false) result.detail = `rejected: ${String(msg[3] ?? '')}`
        if (msg[0] === 'AUTH') result.detail = 'requires NIP-42 AUTH'
      }
    }
    sub.onmessage = event => {
      const msg = JSON.parse(String(event.data)) as [string, unknown, unknown?]
      if (msg[0] === 'EVENT' && msg[1] === 'h') {
        result.ok = true
        result.ms = Date.now() - started
        result.detail = undefined
        done()
      }
      if (msg[0] === 'AUTH') result.detail = 'requires NIP-42 AUTH'
      if (msg[0] === 'NOTICE') result.detail ??= `notice: ${String(msg[1]).slice(0, 80)}`
    }
  })
}

/** Probe several relays concurrently (they are independent hosts). */
export function probeNostrRelays(
  urls: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RelayProbeResult[]> {
  return Promise.all(urls.map(url => probeNostrRelay(url, timeoutMs)))
}
