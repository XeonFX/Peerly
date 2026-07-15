/**
 * Non-secret E2E fixtures. Split from e2eKeys.ts so the key material can live
 * behind a dynamic import while these stay reachable from synchronous code.
 * Nothing here can authenticate anyone on its own.
 */
export const E2E_GOOGLE_CLIENT_ID = 'e2e-test-client.apps.googleusercontent.com'
export const E2E_WORKSPACE_ID = 'e2e00000000000000000000000000001'
export const E2E_WORKSPACE_NAME = 'test-ws'
export const E2E_CREATOR_KEY_ID =
  'P-256:8P4Z2lNdJt4YQ0JHwUlf6VYjLPBawlzGYEIfOp6iGVk:ez4RYxA-xlOdDnx22e7WVvsaCiD7jsAxORhnvLlINBo'

export const E2E_ALLOW_LIST = {
  emails: ['alice@e2e.test', 'bob@e2e.test'],
  signedAt: 1_700_000_000_000,
  signature:
    'N-cRwFdnMUSMOvqOT35SsZrajdJbgwSVTHpmIaa19qbDjBkiTPzDKPIoBsw5GnXld80miGvTd0UQz7fXQC5wqw',
}
