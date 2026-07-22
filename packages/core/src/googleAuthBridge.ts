type BridgeMessage = {
  type?: string
  state?: string
  credential?: string
  error?: string
}

export function normalizeGoogleAuthBridgeOrigin(value: string | undefined): string | undefined {
  const configured = value?.trim()
  return configured ? new URL(configured).origin : undefined
}

/** Render Google's official button from a configured stable auth origin. */
export function renderGoogleSignInBridgeButton(
  container: HTMLElement,
  nonce: string,
  clientId: string,
  bridgeOrigin: string,
  messageType: string
): Promise<string> {
  const state = crypto.randomUUID()
  const url = new URL('/api/auth/google/bridge', bridgeOrigin)
  url.searchParams.set('parent_origin', window.location.origin)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('state', state)

  const iframe = document.createElement('iframe')
  iframe.src = url.href
  iframe.title = 'Sign in with Google'
  iframe.width = '340'
  iframe.height = '76'
  iframe.style.border = '0'
  iframe.style.display = 'block'
  iframe.style.maxWidth = '100%'
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox')

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (result: string | Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const onMessage = (event: MessageEvent<BridgeMessage>) => {
      if (event.origin !== bridgeOrigin || event.source !== iframe.contentWindow) return
      if (event.data?.type !== messageType || event.data.state !== state) return
      if (event.data.error) finish(new Error(event.data.error))
      else if (event.data.credential) finish(event.data.credential)
    }
    const timeout = window.setTimeout(() => finish(new Error('Google Sign-In timed out')), 120_000)
    window.addEventListener('message', onMessage)
    container.replaceChildren(iframe)
  })
}
