import { createProcessRunner } from './spawn-utils.mjs'

const { run } = createProcessRunner()

// Dev uses the same public Nostr signaling a deployed build uses. There is no
// local relay process: a dev setup that only works against a relay we run
// ourselves hides real signaling problems until production.
//
// To use a local relay instead (offline work, or to stay off public relays):
//   npm run dev:relay
console.log('\nStarting Flux — signaling: public Nostr relays\n')

run('vite', 'npx', ['vite', '--host'], {
  VITE_SIGNALING: 'nostr',
})
