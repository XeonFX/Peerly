import type { DeviceKeyId } from './deviceIdentity'
import { renderGoogleSignInButton } from './googleAuth'
import {
  getIdentityProvider,
  type IdentityProvider,
  type IdentityProviderId,
} from './identityProviders'
import { signInWithApple, getAppleRedirectUri } from './appleAuth'
import { signInWithMicrosoft } from './microsoftAuth'
import { signInWithGenericOidc } from './oidcAuth'

export async function signInWithProvider(
  providerId: IdentityProviderId,
  deviceKeyId: DeviceKeyId
): Promise<string> {
  const provider = getIdentityProvider(providerId)
  if (!provider) {
    throw new Error(`Identity provider "${providerId}" is not configured`)
  }
  return signInWithProviderConfig(provider, deviceKeyId)
}

export async function signInWithProviderConfig(
  provider: IdentityProvider,
  deviceKeyId: DeviceKeyId
): Promise<string> {
  switch (provider.id) {
    case 'google': {
      const container = document.querySelector<HTMLElement>('[data-signin-container="google"]')
      if (!container) throw new Error('Google sign-in UI not ready')
      container.innerHTML = ''
      return renderGoogleSignInButton(container, deviceKeyId, provider.clientId)
    }
    case 'microsoft': {
      // No 'common' fallback: microsoftProvider() refuses to build a config
      // without a pinned tenant, so signing in against a different tenant than
      // the one we verify tokens for would only produce confusing failures.
      const tenant = import.meta.env.VITE_MICROSOFT_TENANT_ID?.trim()
      if (!tenant) throw new Error('VITE_MICROSOFT_TENANT_ID is required for Microsoft sign-in')
      return signInWithMicrosoft(provider.clientId, tenant, deviceKeyId)
    }
    case 'apple':
      return signInWithApple(provider.clientId, deviceKeyId, getAppleRedirectUri())
    case 'oidc': {
      const issuer = import.meta.env.VITE_OIDC_ISSUER?.trim()
      if (!issuer) throw new Error('VITE_OIDC_ISSUER is required for generic OIDC')
      return signInWithGenericOidc(provider.clientId, issuer, deviceKeyId)
    }
    default:
      throw new Error(`Unsupported identity provider: ${provider.id}`)
  }
}