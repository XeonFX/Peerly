import { useCallback, useEffect, useRef, useState } from 'react'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import { renderGoogleSignInButton } from '../collab/googleAuth'
import {
  getConfiguredIdentityProviders,
  getIdentityProvider,
  identityConfigurationError,
  type IdentityProviderId,
} from '../collab/identityProviders'
import { signInWithProvider } from '../collab/providerSignIn'
import { deriveUserId } from '../collab/userId'
import { WorkspaceAuthManager } from '../collab/workspaceAuth'
import { Avatar } from './Avatar'

export type SignedInIdentity = {
  email: string
  name?: string
  token: string
  providerId: IdentityProviderId
  /** Durable user id (hash of the token's iss+sub) — see collab/userId. */
  userId?: string
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

/** Compact identity chip, shown at the top once signed in. */
function SignedInChip({
  signedIn,
  busy,
  onSignOut,
}: {
  signedIn: SignedInIdentity
  busy: boolean
  onSignOut: () => void
}) {
  const label = getIdentityProvider(signedIn.providerId)?.label
  return (
    <div
      className="signed-in-banner flex items-center gap-3 rounded-box border border-base-300 bg-base-200 px-3 py-2"
      data-testid="signed-in-user"
    >
      <Avatar name={signedIn.name ?? signedIn.email} color="#2eb67d" size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-base-content">
          {signedIn.name ?? signedIn.email}
        </p>
        <p className="truncate text-xs text-base-content/60">
          {signedIn.email}
          {label ? ` · ${label}` : ''}
        </p>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        data-testid="sign-out"
        onClick={onSignOut}
        disabled={busy}
      >
        Sign out
      </button>
    </div>
  )
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
  const [e2eEmail, setE2eEmail] = useState('alice@e2e.test')

  const completeSignIn = useCallback(
    async (providerId: IdentityProviderId, token: string) => {
      const claims = await authManager.verifyAndStoreIdToken(token, providerId)
      const userId = await deriveUserId(claims.iss, claims.sub)
      onSignedIn({ email: claims.email, name: claims.name, token, providerId, userId })
    },
    [authManager, onSignedIn]
  )

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
      const email = e2eEmail.trim()
      if (!email) throw new Error('Enter your email to continue')
      const claims = await authManager.signInWithE2eEmail(email)
      const token = authManager.getIdToken()
      if (!token) throw new Error('Sign-in failed')
      const userId = await deriveUserId(claims.iss, claims.sub)
      onSignedIn({ email: claims.email, name: claims.name, token, providerId: 'google', userId })
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
        // Dismissed Google prompt or render failure — user can retry via sign out / refresh.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [signedIn, hasGoogle, googleMountKey, authManager, completeSignIn])

  if (signedIn) {
    return (
      <SignedInChip
        signedIn={signedIn}
        busy={busy}
        onSignOut={() => {
          onSignOut()
          setGoogleMountKey(key => key + 1)
        }}
      />
    )
  }

  // Test mode owns its email field rather than reaching into the DOM for one the
  // join screen happened to render. That coupling is also why the field used to
  // sit inside the create-workspace form: it is a sign-in input, and it has to
  // exist *before* sign-in — which is exactly what gating that form would break.
  if (isE2eAuthBypass()) {
    return (
      <div className="flex flex-col gap-3" data-testid="identity-login">
        <label className="w-full">
          <span className="mb-1 block text-xs font-medium text-base-content/70">
            Your email (test mode)
          </span>
          <input
            type="email"
            className="input input-bordered w-full"
            placeholder="alice@e2e.test"
            data-testid="e2e-email"
            value={e2eEmail}
            onChange={e => setE2eEmail(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary w-full"
          data-testid="signin-e2e"
          onClick={() => void handleE2eSignIn()}
          disabled={busy}
        >
          {busy ? 'Signing in…' : 'Sign in (test mode)'}
        </button>
      </div>
    )
  }

  if (providers.length === 0) {
    return (
      <div role="alert" className="alert alert-error" data-testid="no-identity-provider">
        <span className="text-sm">{identityConfigurationError()}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="identity-login">
      <div className="flex flex-col items-center gap-2" data-testid="identity-providers">
        {providers.map(provider =>
          provider.id === 'google' ? (
            // Google renders its own button (an iframe) into this slot, so we
            // cannot style it — the others are sized to match it instead.
            <div
              key="google"
              ref={googleContainerRef}
              className="google-signin-slot flex min-h-10 w-full justify-center"
              data-signin-container="google"
              data-testid="google-signin"
            />
          ) : (
            <button
              key={provider.id}
              type="button"
              className="btn btn-outline w-full"
              data-testid={`signin-${provider.id}`}
              onClick={() => void handleProviderSignIn(provider.id)}
              disabled={busy}
            >
              Continue with {provider.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
