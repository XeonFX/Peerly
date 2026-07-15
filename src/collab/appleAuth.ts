const SCRIPT_SRC =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'

type AppleAuthorization = {
  id_token: string
  code?: string
  state?: string
}

type AppleSignInResponse = {
  authorization: AppleAuthorization
  user?: { email?: string; name?: { firstName?: string; lastName?: string } }
}

type AppleAuthApi = {
  init(config: {
    clientId: string
    scope: string
    redirectURI: string
    nonce: string
    usePopup: boolean
  }): void
  signIn(): Promise<AppleSignInResponse>
}

declare global {
  interface Window {
    AppleID?: { auth: AppleAuthApi }
  }
}

let scriptLoadPromise: Promise<void> | null = null

function loadAppleScript(): Promise<void> {
  if (window.AppleID?.auth) return Promise.resolve()
  if (scriptLoadPromise) return scriptLoadPromise

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Sign in with Apple')))
      return
    }

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Sign in with Apple'))
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

export function getAppleRedirectUri(): string {
  return import.meta.env.VITE_APPLE_REDIRECT_URI?.trim() || window.location.origin
}

export async function signInWithApple(
  clientId: string,
  nonce: string,
  redirectUri = getAppleRedirectUri()
): Promise<string> {
  await loadAppleScript()
  const auth = window.AppleID?.auth
  if (!auth) throw new Error('Sign in with Apple failed to initialize')

  auth.init({
    clientId,
    scope: 'name email',
    redirectURI: redirectUri,
    nonce,
    usePopup: true,
  })

  const response = await auth.signIn()
  const token = response.authorization?.id_token
  if (!token) throw new Error('Apple did not return an id_token')
  return token
}