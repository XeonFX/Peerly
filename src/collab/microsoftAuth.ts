import { openOidcPopup } from './oidcPopup'

export async function signInWithMicrosoft(
  clientId: string,
  tenant: string,
  nonce: string
): Promise<string> {
  const redirectUri = window.location.origin
  const authUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`
  )
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'id_token')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'openid profile email')
  authUrl.searchParams.set('response_mode', 'fragment')
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('prompt', 'select_account')

  return openOidcPopup(authUrl.toString(), redirectUri)
}