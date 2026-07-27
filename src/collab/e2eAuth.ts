import type { JwksFetcher } from './oidcIdToken'
import type { WorkspaceInvite } from './inviteLink'
import {
  E2E_ALLOW_LIST,
  E2E_CREATOR_KEY_ID,
  E2E_WORKSPACE_ID,
  E2E_WORKSPACE_NAME,
} from './e2eConstants'

export {
  E2E_GOOGLE_CLIENT_ID,
  E2E_WORKSPACE_ID,
  E2E_WORKSPACE_NAME,
  E2E_CREATOR_KEY_ID,
} from './e2eConstants'

export function isE2eAuthBypass(): boolean {
  return import.meta.env.VITE_E2E_AUTH_BYPASS === 'true'
}

/**
 * The only path to the E2E signing key, and the reason it never ships.
 *
 * The guard is deliberately an inline `import.meta.env` comparison rather than
 * a call to isE2eAuthBypass(). Vite replaces that expression with a literal at
 * build time, so in a production build this folds to `if (true) throw`, the
 * dynamic import below becomes unreachable, and the bundler drops ./e2eKeys —
 * private key and all — from the output entirely. Routing this through a
 * function call would leave the bundler unable to prove the branch dead, and a
 * real RSA key that mints tokens this app trusts would be published in the
 * bundle of every deployment. `npm run guard:bundle` enforces this.
 */
async function loadE2eKeys() {
  if (import.meta.env.VITE_E2E_AUTH_BYPASS !== 'true') {
    throw new Error('E2E auth bypass is not enabled')
  }
  return import('./e2eKeys')
}

export function getE2eInvite(): WorkspaceInvite {
  return {
    v: 1,
    workspaceId: E2E_WORKSPACE_ID,
    workspaceName: E2E_WORKSPACE_NAME,
    creatorKeyId: E2E_CREATOR_KEY_ID,
    allowList: E2E_ALLOW_LIST,
  }
}

export function getE2eJwksFetcher(): JwksFetcher {
  return async () => (await loadE2eKeys()).e2eJwks()
}

export async function issueE2eGoogleToken(
  email: string,
  nonce: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { mintE2eToken } = await loadE2eKeys()
  return mintE2eToken(email, nonce, overrides)
}

/**
 * The browser E2E harness that runs against real Durable Objects signs in
 * through the generic `oidc` provider rather than the Google one, because the
 * *worker* has to verify the token too and it can only fetch a JWKS from a URL
 * it is given. The harness serves one at its own origin and points both halves
 * at it.
 *
 * Configuration, not a code branch: a build that sets neither variable gets
 * `null` here and the Google path as before, and a deployment that sets
 * neither resolves the provider itself to `null` and 503s.
 */
export function e2eOidcTarget(): { issuer: string; clientId: string } | null {
  const issuer = import.meta.env.VITE_OIDC_ISSUER
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID
  if (typeof issuer !== 'string' || !issuer.trim()) return null
  if (typeof clientId !== 'string' || !clientId.trim()) return null
  return { issuer: issuer.trim().replace(/\/$/, ''), clientId: clientId.trim() }
}

/** An id token the generic `oidc` provider — and the worker — will accept. */
export async function issueE2eOidcToken(
  target: { issuer: string; clientId: string },
  email: string,
  nonce: string
): Promise<string> {
  const { mintE2eToken } = await loadE2eKeys()
  return mintE2eToken(email, nonce, { iss: target.issuer, aud: target.clientId })
}
