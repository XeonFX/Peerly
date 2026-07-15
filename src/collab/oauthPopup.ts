/** Popup handler for OAuth/OIDC redirects — fragment or query callbacks. */

function parseParams(location: string, mode: 'fragment' | 'query'): Record<string, string> {
  const part = mode === 'fragment' ? location.split('#')[1] ?? '' : location.split('?')[1]?.split('#')[0] ?? ''
  return Object.fromEntries(new URLSearchParams(part).entries())
}

export function openOAuthPopup(
  authUrl: string,
  expectedOrigin: string,
  mode: 'fragment' | 'query',
  timeoutMs = 120_000
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, 'oauth-signin', 'width=520,height=720')
    if (!popup) {
      reject(new Error('Popup blocked — allow popups for this site to sign in'))
      return
    }

    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      clearTimeout(timeout)
      try {
        popup.close()
      } catch {
        // ignore
      }
      fn()
    }

    const timer = window.setInterval(() => {
      if (popup.closed) {
        finish(() => reject(new Error('Sign-in cancelled')))
        return
      }

      let href: string
      try {
        href = popup.location.href
      } catch {
        return
      }

      if (!href.startsWith(expectedOrigin)) return

      const params = parseParams(href, mode)
      if (params.error) {
        finish(() => reject(new Error(params.error_description ?? params.error)))
        return
      }

      const ready = mode === 'fragment' ? !!params.id_token : !!params.code
      if (ready) {
        finish(() => resolve(params))
      }
    }, 200)

    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error('Sign-in timed out')))
    }, timeoutMs)
  })
}