import { openOidcPopup } from './oidcPopup'

type OidcDiscovery = {
  issuer: string
  authorization_endpoint: string
  jwks_uri: string
}

const discoveryCache = new Map<string, OidcDiscovery>()

export async function fetchOidcDiscovery(issuer: string): Promise<OidcDiscovery> {
  const normalized = issuer.replace(/\/$/, '')
  const cached = discoveryCache.get(normalized)
  if (cached) return cached

  const res = await fetch(`${normalized}/.well-known/openid-configuration`)
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`)
  const doc = (await res.json()) as OidcDiscovery
  discoveryCache.set(normalized, doc)
  return doc
}

export async function signInWithGenericOidc(
  clientId: string,
  issuer: string,
  nonce: string
): Promise<string> {
  const discovery = await fetchOidcDiscovery(issuer)
  const redirectUri = window.location.origin
  const authUrl = new URL(discovery.authorization_endpoint)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'id_token')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'openid profile email')
  authUrl.searchParams.set('response_mode', 'fragment')
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('prompt', 'select_account')

  return openOidcPopup(authUrl.toString(), redirectUri)
}