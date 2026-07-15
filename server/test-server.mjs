import { writeFileSync } from 'fs'
import { createProcessRunner } from './spawn-utils.mjs'

const RELAY_PORT = Number(process.env.TEST_RELAY_PORT) || 17274
const APP_PORT = Number(process.env.TEST_APP_PORT) || 17273

/**
 * Signaling for E2E.
 *
 * Default is the local relay, deliberately. The suite opens dozens of relay
 * connections per run from one IP, and public Nostr relays throttle that: tests
 * pass individually and then time out at "Signaling offline" mid-suite, with no
 * bug to find. They are also volunteer-run infrastructure that a CI loop has no
 * business hammering.
 *
 * `npm run test:e2e:nostr` runs a small subset against public relays to cover
 * the signaling path a deployed build actually uses.
 */
const useNostr = process.env.E2E_SIGNALING === 'nostr'
const { run } = createProcessRunner()

if (useNostr) {
  run('vite', 'npx', ['vite', '--host', '--port', String(APP_PORT), '--strictPort'], {
    VITE_SIGNALING: 'nostr',
  })
} else {
  writeFileSync('.relay-port', String(RELAY_PORT))
  run('relay', 'node', ['server/relay.mjs'], { RELAY_PORT: String(RELAY_PORT) })

  setTimeout(() => {
    run('vite', 'npx', ['vite', '--host', '--port', String(APP_PORT), '--strictPort'], {
      VITE_SIGNALING: 'ws-relay',
      VITE_RELAY_PORT: String(RELAY_PORT),
      VITE_E2E_AUTH_BYPASS: 'true',
    })
  }, 500)
}
