import {
  normalizeGoogleAuthBridgeOrigin,
  renderGoogleSignInBridgeButton as renderSharedBridgeButton,
} from '@peerly/core'

export function getGoogleAuthBridgeOrigin(): string | undefined {
  return normalizeGoogleAuthBridgeOrigin(import.meta.env.VITE_GOOGLE_AUTH_BRIDGE_ORIGIN)
}

export function renderGoogleSignInBridgeButton(
  container: HTMLElement,
  nonce: string,
  clientId: string,
  bridgeOrigin: string
): Promise<string> {
  return renderSharedBridgeButton(
    container,
    nonce,
    clientId,
    bridgeOrigin,
    'peerly-google-auth-credential'
  )
}
