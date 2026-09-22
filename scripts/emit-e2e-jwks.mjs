import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Publish the E2E issuer's public keys as a real JWKS endpoint in `dist/`.
 *
 * The browser E2E harness signs in through the generic `oidc` provider, and
 * the *worker* verifies those tokens too — it can only do that by fetching a
 * JWKS from a URL. Serving the same fixture the client mints against makes the
 * harness exercise the real verification path on both sides rather than a
 * stub.
 *
 * Deliberately not part of `npm run build`. A deployment must never serve
 * this: a JWKS at the app's own origin, paired with VITE_OIDC_ISSUER pointing
 * at that origin, is an identity provider anyone can mint tokens for. The E2E
 * server calls this explicitly, after the build, for exactly one run.
 */
const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../e2e/fixtures/oidcJwks.json')
const outDir = process.argv[2] ?? 'dist'
const target = resolve(here, `../${outDir}/.well-known/jwks.json`)

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`emit-e2e-jwks: ${target}`)
