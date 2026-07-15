import { useEffect, useRef, useState } from 'react'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import { renderGoogleSignInButton } from '../collab/googleAuth'
import {
  getConfiguredIdentityProviders,
  getIdentityProvider,
  identityConfigurationError,
  type IdentityProviderId,
} from '../collab/identityProviders'
import { signInWithProvider } from '../collab/providerSignIn'
import { WorkspaceAuthManager } from '../collab/workspaceAuth'

export type SignedInIdentity = {
  email: string
  name?: string
  token: string
  providerId: IdentityProviderId
}

type Props = {
  authManager: WorkspaceAuthManager
  signedIn: SignedInIdentity | null
  onSignedIn: (identity: SignedInIdentity) => void
  onSignOut: () => void
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onError: (message: string | null) => void
}

export function IdentityLoginButtons({
  authManager,
  signedIn,
  onSignedIn,
  onSignOut,
  busy,
  onBusyChange,
  onError,
}: Props) {
  const providers = getConfiguredIdentityProviders()
  const googleContainerRef = useRef<HTMLDivElement>(null)
  const [googleMountKey, setGoogleMountKey] = useState(0)

  const completeSignIn = async (providerId: IdentityProviderId, token: string) => {
    const claims = await authManager.verifyAndStoreIdToken(token, providerId)
    onSignedIn({
      email: claims.email,
      name: claims.name,
      token,
      providerId,
    })
  }

  const handleProviderSignIn = async (providerId: IdentityProviderId) => {
    onError(null)
    onBusyChange(true)
    try {
      const provider = getIdentityProvider(providerId)
      if (!provider) throw new Error(`Identity provider "${providerId}" is not configured`)

      const keyId = await authManager.deviceKeyId()
      const token = await signInWithProvider(providerId, keyId)
      await completeSignIn(providerId, token)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      onBusyChange(false)
    }
  }

  const handleE2eSignIn = async () => {
    onError(null)
    onBusyChange(true)
    try {
      const emailInput = document.querySelector<HTMLInputElement>('[data-testid="e2e-email"]')
      const email = emailInput?.value.trim()
      if (!email) throw new Error('Enter your email to continue')
      const claims = await authManager.signInWithE2eEmail(email)
      const token = authManager.getIdToken()
      if (!token) throw new Error('Sign-in failed')
      onSignedIn({ email: claims.email, name: claims.name, token, providerId: 'google' })
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      onBusyChange(false)
    }
  }

  const hasGoogle = providers.some(provider => provider.id === 'google')

  useEffect(() => {
    if (signedIn || isE2eAuthBypass() || !hasGoogle) return

    const provider = getIdentityProvider('google')
    const container = googleContainerRef.current
    if (!provider || !container) return

    let cancelled = false
    container.innerHTML = ''

    void (async () => {
      try {
        const keyId = await authManager.deviceKeyId()
        if (cancelled) return
        const token = await renderGoogleSignInButton(container, keyId, provider.clientId)
        if (cancelled) return
        await completeSignIn('google', token)
      } catch {
        // Dismissed Google prompt or render failure — user can retry via page refresh / sign out.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [signedIn, hasGoogle, googleMountKey, authManager])

  if (isE2eAuthBypass()) {
    if (signedIn) {
      return (
        <div className="signed-in-banner" data-testid="signed-in-user">
          <span>
            Signed in as <strong>{signedIn.email}</strong>
          </span>
          <button
            type="button"
            className="btn-link"
            data-testid="sign-out"
            onClick={onSignOut}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      )
    }
    return (
      <button
        type="button"
        className="btn-login"
        data-testid="signin-e2e"
        onClick={() => void handleE2eSignIn()}
        disabled={busy}
      >
        {busy ? 'Signing in…' : 'Sign in (test mode)'}
      </button>
    )
  }

  if (providers.length === 0) {
    return (
      <p className="error-banner" data-testid="no-identity-provider">
        {identityConfigurationError()}
      </p>
    )
  }

  if (signedIn) {
    const label = getIdentityProvider(signedIn.providerId)?.label ?? signedIn.providerId
    return (
      <div className="signed-in-banner" data-testid="signed-in-user">
        <span>
          Signed in as <strong>{signedIn.email}</strong> ({label})
        </span>
        <button
          type="button"
          className="btn-link"
          data-testid="sign-out"
          onClick={() => {
            onSignOut()
            setGoogleMountKey(key => key + 1)
          }}
          disabled={busy}
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="identity-login" data-testid="identity-login">
      <p className="identity-login-label">Sign in to continue</p>
      <div className="identity-login-buttons" data-testid="identity-providers">
        {providers.map(provider =>
          provider.id === 'google' ? (
            <div
              key="google"
              ref={googleContainerRef}
              className="google-signin-slot"
              data-signin-container="google"
              data-testid="google-signin"
            />
          ) : (
            <button
              key={provider.id}
              type="button"
              className="btn-login"
              data-testid={`signin-${provider.id}`}
              onClick={() => void handleProviderSignIn(provider.id)}
              disabled={busy}
            >
              Sign in with {provider.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}