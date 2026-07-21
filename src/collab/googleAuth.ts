// The direct GIS wrapper lives in @peerly/core. Branch previews render the
// same official button through a stable, Google-authorized bridge origin.
import { renderGoogleSignInButton as renderDirectGoogleSignInButton } from '@peerly/core'
import { getGoogleAuthBridgeOrigin, renderGoogleSignInBridgeButton } from './googleAuthBridge'

export function renderGoogleSignInButton(
  container: HTMLElement,
  nonce: string,
  clientId: string
): Promise<string> {
  const bridgeOrigin = getGoogleAuthBridgeOrigin()
  return bridgeOrigin
    ? renderGoogleSignInBridgeButton(container, nonce, clientId, bridgeOrigin)
    : renderDirectGoogleSignInButton(container, nonce, clientId)
}

export function getGoogleClientId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined
}
