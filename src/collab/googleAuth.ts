import { createGoogleSignInClient } from '@peerly/core'

export const googleSignInClient = createGoogleSignInClient({
  bridgeOrigin: import.meta.env.VITE_GOOGLE_AUTH_BRIDGE_ORIGIN,
  messageType: 'peerly-google-auth-credential',
})

export function renderGoogleSignInButton(
  container: HTMLElement,
  nonce: string,
  clientId: string
): Promise<string> {
  return googleSignInClient.renderButton(container, nonce, clientId)
}

export function getGoogleClientId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined
}
