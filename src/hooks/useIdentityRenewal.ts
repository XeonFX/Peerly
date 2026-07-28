import { renewGoogleCredentialSilently } from '@peerly/core'
import { useCredentialRenewal } from '@peerly/core/react'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import { getIdentityProvider } from '../collab/identityProviders'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import { googleSignInClient } from '../collab/googleAuth'
import {
  idTokenExpiryMs,
  loadIdentityEmail,
  loadIdentityProvider,
  loadIdentityUserId,
  loadIdToken,
  saveIdCredentials,
} from '../session'

/**
 * Keep a live ID token without asking the user.
 *
 * Storing the token across restarts is only half of "sign in once": Google's
 * tokens last about an hour, so without this the interruption simply moves
 * from every restart to every hour.
 *
 * Two things were wrong before. The re-auth prompt lived inside the workspace
 * component, so on the friends or DM screens a token could expire with nothing
 * offering to renew it — the app just quietly stopped working. And it reacted
 * to expiry rather than anticipating it, so there was always a window where
 * requests failed first and the user was told second.
 *
 * This runs app-wide and renews *before* expiry. When Google declines to do it
 * silently — several accounts signed in, consent withdrawn, third-party
 * cookies blocked — it gives up quietly and leaves the visible sign-in path to
 * handle it. A failed silent renewal must never become a popup the user did
 * not ask for.
 */

export function useIdentityRenewal(identity: DeviceIdentity, hasRememberedIdentity: boolean): number {
  const token = loadIdToken()
  const expiresAt = token ? idTokenExpiryMs(token) : null

  return useCredentialRenewal({
    enabled: hasRememberedIdentity && !isE2eAuthBypass(),
    expiresAt,
    retryWhenMissing: true,
    renew: async () => {
      const provider = loadIdentityProvider()
      const email = loadIdentityEmail()
      // Only Google exposes a silent re-issue path today. Other providers fall
      // through to the visible flow, exactly as before.
      if (provider !== 'google' || !email) return null

      const config = getIdentityProvider('google')
      if (!config?.clientId) return null

      return renewGoogleCredentialSilently({
        client: googleSignInClient,
        clientId: config.clientId,
        nonce: await identity.publicKeyId(),
        remembered: {
          email,
          userId: loadIdentityUserId() ?? undefined,
        },
        fetchJwks: config.fetchJwks,
      })
    },
    onRenewed: renewed => {
      saveIdCredentials(
        renewed.token,
        'google',
        renewed.claims.email,
        renewed.userId
      )
    },
  })
}
