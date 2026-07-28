import {
  renderGoogleSignInButton,
  requestGoogleCredentialSilently,
} from './googleSignIn.js'

type BridgeMessage = {
  type?: string
  state?: string
  credential?: string
  error?: string
  unavailable?: boolean
}

export function normalizeGoogleAuthBridgeOrigin(value: string | undefined): string | undefined {
  const configured = value?.trim()
  return configured ? new URL(configured).origin : undefined
}

async function requestGoogleSignInBridgeCredential(
  container: HTMLElement,
  nonce: string,
  clientId: string,
  bridgeOrigin: string,
  messageType: string,
  silent: boolean
): Promise<string | null> {
  const state = crypto.randomUUID()
  const url = new URL('/api/auth/google/bridge', bridgeOrigin)
  url.searchParams.set('parent_origin', window.location.origin)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('state', state)
  if (silent) url.searchParams.set('mode', 'silent')

  const iframe = document.createElement('iframe')
  iframe.src = url.href
  iframe.title = 'Sign in with Google'
  iframe.width = silent ? '1' : '340'
  iframe.height = silent ? '1' : '76'
  iframe.style.border = '0'
  iframe.style.display = silent ? 'none' : 'block'
  iframe.style.maxWidth = '100%'
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox')

  return new Promise<string | null>((resolve, reject) => {
    let settled = false
    const finish = (result: string | Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      if (result instanceof Error) {
        if (silent) resolve(null)
        else reject(result)
      }
      else resolve(result)
    }
    const onMessage = (event: MessageEvent<BridgeMessage>) => {
      if (event.origin !== bridgeOrigin || event.source !== iframe.contentWindow) return
      if (event.data?.type !== messageType || event.data.state !== state) return
      if (event.data.error) finish(new Error(event.data.error))
      else if (event.data.unavailable) finish('')
      else if (event.data.credential) finish(event.data.credential)
    }
    const timeout = window.setTimeout(
      () => finish(new Error('Google Sign-In timed out')),
      silent ? 10_000 : 120_000
    )
    window.addEventListener('message', onMessage)
    container.replaceChildren(iframe)
  }).then(credential => credential || null)
}

/** Render Google's official button from a configured stable auth origin. */
export async function renderGoogleSignInBridgeButton(
  container: HTMLElement,
  nonce: string,
  clientId: string,
  bridgeOrigin: string,
  messageType: string
): Promise<string> {
  const credential = await requestGoogleSignInBridgeCredential(
    container,
    nonce,
    clientId,
    bridgeOrigin,
    messageType,
    false
  )
  if (!credential) throw new Error('Google Sign-In did not return a credential')
  return credential
}

/** Ask for silent Google renewal through the stable OAuth bridge origin. */
export function requestGoogleCredentialSilentlyFromBridge(
  nonce: string,
  clientId: string,
  bridgeOrigin: string,
  messageType: string
): Promise<string | null> {
  const container = document.createElement('div')
  container.hidden = true
  document.body.appendChild(container)
  return requestGoogleSignInBridgeCredential(
    container,
    nonce,
    clientId,
    bridgeOrigin,
    messageType,
    true
  ).finally(() => container.remove())
}

export type GoogleSignInClientOptions = {
  /** Optional stable origin registered with Google for preview deployments. */
  bridgeOrigin?: string
  /** App-owned postMessage discriminator configured on its auth Worker. */
  messageType: string
}

export type GoogleSignInClient = {
  /** Bridge origin used from the current page, or undefined for direct GIS. */
  bridgeOrigin(currentOrigin?: string): string | undefined
  renderButton(container: HTMLElement, nonce: string, clientId: string): Promise<string>
  requestCredentialSilently(nonce: string, clientId: string): Promise<string | null>
}

/**
 * One product-neutral Google sign-in adapter for direct and bridged hosts.
 *
 * The core owns transport selection and iframe mechanics. Consumers retain
 * their own environment variable and message type, so no application naming
 * or deployment configuration crosses package boundaries.
 */
export function createGoogleSignInClient(
  options: GoogleSignInClientOptions
): GoogleSignInClient {
  const configuredBridgeOrigin = normalizeGoogleAuthBridgeOrigin(options.bridgeOrigin)
  if (!options.messageType.trim()) throw new Error('Google auth bridge message type is required')

  const bridgeOrigin = (
    currentOrigin = typeof window === 'undefined' ? undefined : window.location.origin
  ): string | undefined =>
    configuredBridgeOrigin && configuredBridgeOrigin !== currentOrigin
      ? configuredBridgeOrigin
      : undefined

  return {
    bridgeOrigin,
    renderButton: (container, nonce, clientId) => {
      const origin = bridgeOrigin()
      return origin
        ? renderGoogleSignInBridgeButton(
            container,
            nonce,
            clientId,
            origin,
            options.messageType
          )
        : renderGoogleSignInButton(container, nonce, clientId)
    },
    requestCredentialSilently: (nonce, clientId) => {
      const origin = bridgeOrigin()
      return origin
        ? requestGoogleCredentialSilentlyFromBridge(
            nonce,
            clientId,
            origin,
            options.messageType
          )
        : requestGoogleCredentialSilently(clientId, nonce)
    },
  }
}
