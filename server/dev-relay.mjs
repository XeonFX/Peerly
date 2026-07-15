import { existsSync, readFileSync } from 'fs'
import { findFreePort } from './find-port.mjs'
import { createProcessRunner } from './spawn-utils.mjs'

// Opt-in local signaling relay: `npm run dev:relay`.
// Useful offline, or to keep dev traffic off public relays. `npm run dev` uses
// public Nostr, which is what a deployed build actually does.
const preferredRelay = Number(process.env.RELAY_PORT) || 8080
const relayPort = await findFreePort(preferredRelay)
const { run } = createProcessRunner()

run('relay', 'node', ['server/relay.mjs'], { RELAY_PORT: String(relayPort) })

await new Promise(r => setTimeout(r, 400))
const portFile = existsSync('.relay-port')
  ? readFileSync('.relay-port', 'utf8').trim()
  : String(relayPort)

console.log(`\nStarting Peerly — local relay: ws://localhost:${portFile}\n`)

run('vite', 'npx', ['vite', '--host'], {
  VITE_SIGNALING: 'ws-relay',
  VITE_RELAY_PORT: portFile,
})
