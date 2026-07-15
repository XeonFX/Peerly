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
