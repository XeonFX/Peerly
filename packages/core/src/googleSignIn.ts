/**
 * Thin wrapper around Google Identity Services (GIS) — the client-side
 * "Sign in with Google" SDK. Loaded from Google's script, not bundled: it's a
 * small surface and stays current with Google's own security fixes.
 *
 * No server involved. GIS runs the OAuth/OIDC flow in the browser and hands
 * back a signed ID token (a JWT) via a callback; verifyGoogleIdToken.ts checks
 * that JWT against Google's public keys, also entirely client-side.
 */

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

type CredentialResponse = { credential: string }

type PromptMomentNotification = {
  isNotDisplayed(): boolean
  isSkippedMoment(): boolean
  isDismissedMoment(): boolean
}

type GoogleAccountsId = {
  initialize(config: {
    client_id: string
    nonce: string
    callback: (response: CredentialResponse) => void
    auto_select?: boolean
    itp_support?: boolean
    use_fedcm_for_button?: boolean
  }): void
  prompt(listener?: (notification: PromptMomentNotification) => void): void
  renderButton(
    parent: HTMLElement,
    options: { type?: 'standard' | 'icon'; theme?: string; size?: string; text?: string; width?: string | number }
  ): void
  cancel(): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

let scriptLoadPromise: Promise<void> | null = null
let initializedConfig: { clientId: string; nonce: string } | null = null
let activeCredentialHandler: ((response: CredentialResponse) => void) | null = null

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptLoadPromise) return scriptLoadPromise

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Sign-In')))
      return
    }

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Sign-In'))
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}


/**
 * Render an actual "Sign in with Google" button into `container` and resolve
 * with the raw ID token once the user completes sign-in. `nonce` should be
 * derived from the caller's device key (see identityHandshake.ts) so the
 * returned token is bound to a key we can prove live possession of later —
 * that binding is what turns this into more than a bearer credential.
 */
export async function renderGoogleSignInButton(
  container: HTMLElement,
  nonce: string,
  clientId: string
): Promise<string> {
  await loadGisScript()
  const accounts = window.google?.accounts.id
  if (!accounts) throw new Error('Google Sign-In failed to initialize')

  return new Promise<string>((resolve, reject) => {
    try {
      if (
        initializedConfig &&
        (initializedConfig.clientId !== clientId || initializedConfig.nonce !== nonce)
      ) {
        throw new Error('Google Sign-In configuration changed; reload the page and try again')
      }

      // GIS configuration is global to the page. Google documents initialize()
      // as a one-shot call; calling it from every React render replaces the
      // earlier callback and can make an already-rendered button stop working.
      // Keep one stable callback and route the credential to the latest visible
      // button instead.
      activeCredentialHandler = response => resolve(response.credential)
      if (!initializedConfig) {
        accounts.initialize({
          client_id: clientId,
          nonce,
          auto_select: false,
          use_fedcm_for_button: true,
          callback: response => activeCredentialHandler?.(response),
        })
        initializedConfig = { clientId, nonce }
      }
      accounts.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', width: 320 })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}
