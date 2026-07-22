import {
  normalizeGoogleAuthBridgeOrigin,
  renderGoogleSignInBridgeButton as renderSharedBridgeButton,
} from '@peerly/core'

export function getGoogleAuthBridgeOrigin(
  currentOrigin = typeof window === 'undefined' ? undefined : window.location.origin
): string | undefined {
  const bridgeOrigin = normalizeGoogleAuthBridgeOrigin(import.meta.env.VITE_GOOGLE_AUTH_BRIDGE_ORIGIN)
  // The production origin is already registered with Google and can use GIS
  // directly. Treating the same origin as a "bridge" creates an unnecessary
  // iframe dependency and turned a missing Worker variable into a login outage.
  return bridgeOrigin && bridgeOrigin !== currentOrigin ? bridgeOrigin : undefined
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
