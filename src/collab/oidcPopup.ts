import { openOAuthPopup } from './oauthPopup'

/** Implicit OIDC flow — id_token returned in the URL fragment. */
export async function openOidcPopup(
  authUrl: string,
  expectedOrigin: string,
  timeoutMs = 120_000
): Promise<string> {
  const params = await openOAuthPopup(authUrl, expectedOrigin, 'fragment', timeoutMs)
  if (!params.id_token) throw new Error('OIDC provider did not return an id_token')
  return params.id_token
}