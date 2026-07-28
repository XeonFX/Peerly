import { requestGoogleCredentialSilently, verifyGoogleIdToken } from '@peerly/core'
import { useEffect, useRef } from 'react'
import { deriveUserId } from '../collab/userId'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import { getIdentityProvider } from '../collab/identityProviders'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import {
  idTokenExpiryMs,
  loadIdentityEmail,
  loadIdentityProvider,
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

/** Renew this far ahead of expiry, so nothing fails while we are asking. */
const RENEW_BEFORE_MS = 5 * 60_000

/** Floor on retries, so a provider that keeps declining is not hammered. */
const MIN_RETRY_MS = 60_000

export function useIdentityRenewal(identity: DeviceIdentity, signedIn: boolean): void {
  // Held in a ref so a renewal in flight is never started twice, and so the
  // timer can be replaced without re-running the effect.
  const running = useRef(false)

  useEffect(() => {
    // The E2E bypass mints its own tokens; there is no Google to ask.
    if (!signedIn || isE2eAuthBypass()) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const renew = async (): Promise<void> => {
      if (running.current || cancelled) return
      const provider = loadIdentityProvider()
      const email = loadIdentityEmail()
      // Only Google exposes a silent re-issue path today. Other providers fall
      // through to the visible flow, exactly as before.
      if (provider !== 'google' || !email) return

      const config = getIdentityProvider('google')
      if (!config?.clientId) return

      running.current = true
      try {
        const nonce = await identity.publicKeyId()
        const token = await requestGoogleCredentialSilently(config.clientId, nonce)
        if (!token || cancelled) return

        // Verified before it is stored: a token we did not check is a token we
        // would hand to peers and the worker on trust.
        const claims = await verifyGoogleIdToken(token, {
          expectedAudience: config.clientId,
          expectedNonce: nonce,
        })
        if (cancelled) return
        saveIdCredentials(token, 'google', claims.email, await deriveUserId(claims.iss, claims.sub))
      } catch {
        // Declined, blocked, or offline. The visible sign-in path remains.
      } finally {
        running.current = false
      }
    }

    /** Sleep until shortly before the current token lapses, then renew. */
    const schedule = (): void => {
      if (cancelled) return
      const token = loadIdToken()
      const expiresAt = token ? idTokenExpiryMs(token) : null
      // No token, or one we cannot read an expiry from: try now.
      const delay = expiresAt === null
        ? 0
        : Math.max(MIN_RETRY_MS, expiresAt - Date.now() - RENEW_BEFORE_MS)
      timer = setTimeout(() => {
        void renew().finally(schedule)
      }, delay)
    }

    schedule()

    // Coming back to a tab that slept through its own timer is the common way
    // to find an expired token, so re-check on return rather than waiting.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const token = loadIdToken()
      const expiresAt = token ? idTokenExpiryMs(token) : null
      if (expiresAt !== null && expiresAt - Date.now() > RENEW_BEFORE_MS) return
      void renew()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [identity, signedIn])
}
