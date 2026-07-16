import { useCallback, useEffect, useRef, useState } from 'react'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import type { IdentityExpiryPhase } from '../collab/identityExpiry'
import { signInWithProvider } from '../collab/providerSignIn'
import { deriveUserId } from '../collab/userId'
import type { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { saveIdCredentials, type Session } from '../session'
import { useI18n } from '../i18n'

type Props = {
  phase: IdentityExpiryPhase
  session: Session
  authManager: WorkspaceAuthManager | null
  /** Called after a fresh token is stored, so the expiry tracker re-reads it. */
  onReauthed: () => void
}

/**
 * The one-hour cliff, made visible. ID tokens live about an hour; past expiry
 * every NEW handshake fails (joining teammates, reconnects, your own other
 * devices) while existing connections keep working — which used to read as
 * "the app randomly broke". Existing state is untouched by re-auth: only the
 * stored token and the manager's copy are replaced.
 *
 * Re-auth must be the SAME account: the workspace admitted this email, and a
 * different one would break membership mid-session.
 */
export function ReauthBanner({ phase, session, authManager, onReauthed }: Props) {
  const { tr } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const googleHostRef = useRef<HTMLDivElement>(null)
  const e2e = isE2eAuthBypass()
  const provider = session.identityProvider

  const completeWithToken = useCallback(
    async (token: string) => {
      if (!authManager) throw new Error(tr('Still connecting — try again in a moment'))
      const claims = await authManager.verifyAndStoreIdToken(token, provider)
      if (claims.email.toLowerCase() !== session.identityEmail.toLowerCase()) {
        // Roll back: the manager must not keep a token for a different account.
        authManager.setIdToken(null, provider)
        throw new Error(
          tr('Signed in as {actual}, but this workspace admitted {expected}. Use the same account.', {
            actual: claims.email,
            expected: session.identityEmail,
          })
        )
      }
      const userId = await deriveUserId(claims.iss, claims.sub)
      saveIdCredentials(token, provider, claims.email, userId)
      onReauthed()
    },
    [authManager, onReauthed, provider, session.identityEmail, tr]
  )

  const handleReauth = async () => {
    setError(null)
    setBusy(true)
    try {
      if (e2e) {
        if (!authManager) throw new Error(tr('Still connecting — try again in a moment'))
        const claims = await authManager.signInWithE2eEmail(session.identityEmail)
        const token = authManager.getIdToken()
        if (!token) throw new Error(tr('Sign-in failed'))
        const userId = await deriveUserId(claims.iss, claims.sub)
        saveIdCredentials(token, provider, claims.email, userId)
        onReauthed()
        return
      }
      const keyId = await authManager?.deviceKeyId()
      if (!keyId) throw new Error(tr('Still connecting — try again in a moment'))
      await completeWithToken(await signInWithProvider(provider, keyId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Google renders its own button into the container; mount it eagerly so the
  // user's one click is the Google button itself, not a button to get a button.
  const isGoogle = provider === 'google' && !e2e
  useEffect(() => {
    if (!isGoogle || phase === 'ok') return
    let cancelled = false
    void (async () => {
      try {
        const keyId = await authManager?.deviceKeyId()
        if (!keyId || cancelled) return
        const token = await signInWithProvider('google', keyId)
        if (cancelled) return
        await completeWithToken(token)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authManager, completeWithToken, isGoogle, phase])

  if (phase === 'ok') return null

  return (
    <div
      role="alert"
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 text-sm sm:px-5 ${
        phase === 'expired'
          ? 'border-error/25 bg-error/10 text-error'
          : 'border-warning/25 bg-warning/10 text-warning'
      }`}
      data-testid="reauth-banner"
    >
      <span className="min-w-0 flex-1">
        {phase === 'expired'
          ? tr('Your sign-in expired. Current connections keep working, but nobody new can verify you until you sign in again.')
          : tr('Your sign-in expires in a few minutes. Renew it to keep accepting new connections.')}
      </span>
      {isGoogle ? (
        <div ref={googleHostRef} data-signin-container="google" className="shrink-0" />
      ) : (
        <button
          type="button"
          className={`btn btn-sm shrink-0 ${phase === 'expired' ? 'btn-error' : 'btn-warning'}`}
          onClick={() => void handleReauth()}
          disabled={busy}
          data-testid="reauth-button"
        >
          {busy ? `${tr('Signing in')}…` : tr('Sign in again')}
        </button>
      )}
      {error && <span className="basis-full text-xs">{error}</span>}
    </div>
  )
}
