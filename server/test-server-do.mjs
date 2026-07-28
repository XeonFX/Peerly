import { spawnSync } from 'node:child_process'
import { createProcessRunner } from './spawn-utils.mjs'

/**
 * The browser E2E target: a production build served by the real worker, with
 * real Durable Objects, real SQLite and real alarms.
 *
 * Unlike `test-server.mjs` this is a *built* app, not a dev server. The DO
 * backend is chosen at build time from VITE_SIGNALING, and the worker serves
 * the result from `dist/` — so what the test drives is the artefact a
 * deployment would serve, with only the identity provider and the allowed
 * origin differing.
 *
 * See wrangler.e2e.jsonc for why that provider is safe here and nowhere else.
 */
const PORT = Number(process.env.TEST_DO_PORT) || 17275
const ORIGIN = `http://127.0.0.1:${PORT}`

/** Must match wrangler.e2e.jsonc — the client mints for this audience. */
const OIDC_CLIENT_ID = 'peerly-e2e-client'

function runToCompletion(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error(`\n[test-server-do] ${command} ${args.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }
}

// `build:e2e`, not `build`: the shared build runs `guard:bundle`, which must
// stay an unconditional "this artefact may not ship" check rather than one an
// environment variable can talk out of. The E2E path asserts the opposite —
// that the fixtures *are* present — in check-e2e-fixtures.mjs.
runToCompletion('npm', ['run', 'build:e2e'], {
  VITE_APP_ID: 'peerly',
  VITE_SIGNALING: 'durable-objects',
  VITE_E2E_AUTH_BYPASS: 'true',
  // The issuer is this origin, and the JWKS below is served from it. Both
  // halves — browser and worker — then verify through the same real fetch.
  VITE_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
  VITE_OIDC_ISSUER: ORIGIN,
  VITE_OIDC_LABEL: 'E2E',
})

// Into `dist-e2e/`, never `dist/`. Production `wrangler deploy` has no build
// step, so it uploads whatever is already in `dist/` — and a deploy run just
// after the E2E suite would otherwise ship a bundle carrying the test signing
// key. Separate output directories make that impossible rather than unlikely.
runToCompletion('node', ['scripts/emit-e2e-jwks.mjs', 'dist-e2e'], {})

const { run } = createProcessRunner()
run('wrangler', 'npx', [
  'wrangler', 'dev',
  '-c', 'wrangler.e2e.jsonc',
  '--port', String(PORT),
  '--ip', '127.0.0.1',
  // Let the OS pick, so a stale inspector from a previous run cannot wedge
  // the whole suite on a port collision.
  '--inspector-port', '0',
])
