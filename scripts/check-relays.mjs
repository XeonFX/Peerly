/**
 * Health-check the default Nostr relays the way the app actually uses them.
 *
 * A relay that merely accepts a TCP connection is not enough: several open
 * fine and then silently drop the ephemeral events (kind 2xxxx) Trystero
 * signals with, which is indistinguishable from working until two peers fail
 * to find each other. So this subscribes, publishes, and requires the event to
 * come back.
 *
 * Run it before trusting DEFAULT_NOSTR_RELAYS after any edit:
 *   npm run check:relays
 *   npm run check:relays -- wss://candidate.example
 *
 * Public relays come and go. This is a diagnostic, not a test — it is not part
 * of `npm test`, because a third party going down should not fail your build.
 */
import { readFileSync } from 'fs'
import { createEvent } from '@trystero-p2p/nostr'

/**
 * Read the list out of the @peerly/core source rather than importing it: importing would pull
 * in the app's whole module graph (which needs Vite's resolver), and this script
 * should stay runnable with plain node.
 */
function defaultRelays() {
  const source = readFileSync(new URL('../packages/core/src/relays.ts', import.meta.url), 'utf8')
  const block = /export const DEFAULT_NOSTR_RELAYS = \[([\s\S]*?)\]/.exec(source)
  if (!block) throw new Error('Could not find DEFAULT_NOSTR_RELAYS in packages/core/src/relays.ts')
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1])
}

const DEFAULT_NOSTR_RELAYS = defaultRelays()

const strToNum = (str, limit = Number.MAX_SAFE_INTEGER) =>
  str.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % limit
const topicToKind = topic => strToNum(topic, 1e4) + 2e4

const TIMEOUT_MS = 12_000

async function check(url) {
  const topic = 'health-' + Math.random().toString(36).slice(2)
  const kind = topicToKind(topic)

  return new Promise(resolve => {
    const result = { url, echoed: false, error: null, ms: null }
    const started = Date.now()
    let sub, pub

    const done = () => {
      try {
        sub?.close()
        pub?.close()
      } catch {
        // already closing
      }
      resolve(result)
    }
    const timer = setTimeout(() => {
      result.error ??= `timeout after ${TIMEOUT_MS / 1000}s`
      done()
    }, TIMEOUT_MS)

    try {
      sub = new WebSocket(url)
    } catch (err) {
      result.error = `could not connect: ${err.message}`
      clearTimeout(timer)
      return done()
    }

    let opened = false
    sub.onerror = () => {
      result.error ??= 'socket error'
    }
    sub.onclose = event => {
      if (!opened) result.error ??= `closed before open (code ${event.code})`
    }
    sub.onopen = async () => {
      opened = true
      sub.send(
        JSON.stringify(['REQ', 'h', { kinds: [kind], since: Math.floor(Date.now() / 1000) - 5 }])
      )
      await new Promise(r => setTimeout(r, 600))
      pub = new WebSocket(url)
      pub.onerror = () => {}
      pub.onopen = async () => pub.send(await createEvent(topic, 'ping'))
      pub.onmessage = event => {
        const msg = JSON.parse(event.data)
        if (msg[0] === 'OK' && msg[2] === false) result.error = `rejected: ${msg[3] ?? ''}`
        if (msg[0] === 'AUTH') result.error = 'requires NIP-42 AUTH'
      }
    }
    sub.onmessage = event => {
      const msg = JSON.parse(event.data)
      if (msg[0] === 'EVENT' && msg[1] === 'h') {
        result.echoed = true
        result.ms = Date.now() - started
        clearTimeout(timer)
        done()
      }
      if (msg[0] === 'AUTH') result.error = 'requires NIP-42 AUTH'
      if (msg[0] === 'NOTICE') result.error ??= `notice: ${String(msg[1]).slice(0, 60)}`
    }
  })
}

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_NOSTR_RELAYS
console.log(`Checking ${targets.length} relay(s) for ephemeral-event relaying:\n`)

const results = []
for (const url of targets) {
  const result = await check(url)
  results.push(result)
  const verdict = result.echoed ? `HEALTHY (${result.ms}ms)` : 'UNUSABLE'
  console.log(`  ${verdict.padEnd(20)} ${url}${result.error ? `  [${result.error}]` : ''}`)
}

const healthy = results.filter(r => r.echoed).length
console.log(`\n${healthy}/${results.length} healthy.`)

if (healthy === 0) {
  console.error('\nNo relay is usable — peers cannot discover each other at all.')
  process.exit(1)
}
if (healthy < results.length) {
  console.error(
    '\nSome relays are unusable. They only add console noise, so drop them from\n' +
      'DEFAULT_NOSTR_RELAYS in packages/core/src/relays.ts (or replace them) and re-run.'
  )
  process.exit(1)
}
process.exit(0)
