import { createPkcePair } from '../utils/pkce'
import { bytesToBase64Url } from '../utils/base64url'
import { openOAuthPopup } from './oauthPopup'

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token'

type GitHubTokenResponse = {
  access_token?: string
  token_type?: string
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

export async function signInWithGitHub(clientId: string, nonce: string): Promise<string> {
  const redirectUri = window.location.origin
  const { verifier, challenge } = await createPkcePair()
  const state = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))

  const authUrl = new URL(GITHUB_AUTHORIZE)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'openid user:email')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  const callback = await openOAuthPopup(authUrl.toString(), redirectUri, 'query')
  if (callback.state !== state) {
    throw new Error('GitHub OAuth state mismatch')
  }
  const code = callback.code
  if (!code) throw new Error('GitHub did not return an authorization code')

  const proxy = import.meta.env.VITE_GITHUB_TOKEN_PROXY?.trim()
  const tokenRes = proxy
    ? await fetch(proxy, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          client_id: clientId,
        }),
      })
    : await fetch(GITHUB_TOKEN, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
      })

  if (!tokenRes.ok) {
    throw new Error(
      proxy
        ? `GitHub token proxy failed: HTTP ${tokenRes.status}`
        : 'GitHub token exchange failed — set VITE_GITHUB_TOKEN_PROXY if CORS blocks direct exchange'
    )
  }

  const tokens = (await tokenRes.json()) as GitHubTokenResponse
  if (tokens.error) {
    throw new Error(tokens.error_description ?? tokens.error)
  }
  if (!tokens.id_token) {
    throw new Error('GitHub did not return an id_token (ensure openid scope is enabled)')
  }
  return tokens.id_token
}