const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const GOOGLE_JWKS_PATH = '/api/auth/google/jwks'
export const GOOGLE_AUTH_BRIDGE_PATH = '/api/auth/google/bridge'

export function googleAuthPreviewPage(url, expectedClientId, config) {
  const parentOrigin = url.searchParams.get('parent_origin') ?? ''
  const clientId = url.searchParams.get('client_id') ?? ''
  const nonce = url.searchParams.get('nonce') ?? ''
  const state = url.searchParams.get('state') ?? ''
  if (!config.allowedParent(parentOrigin) || !expectedClientId || clientId !== expectedClientId ||
      !nonce || nonce.length > 512 || !state || state.length > 128) {
    return new Response('Invalid auth bridge request', { status: 400 })
  }
  const pageConfig = JSON.stringify({ parentOrigin, clientId, nonce, state }).replaceAll('<', '\\u003c')
  const cspNonce = crypto.randomUUID().replaceAll('-', '')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${config.title}</title></head><body>
<div id="google-button"></div><p id="error" role="alert"></p>
<script nonce="${cspNonce}" src="https://accounts.google.com/gsi/client"></script>
<script nonce="${cspNonce}">
const config=${pageConfig};
const send=value=>parent.postMessage({type:${JSON.stringify(config.messageType)},state:config.state,...value},config.parentOrigin);
try {
  google.accounts.id.initialize({client_id:config.clientId,nonce:config.nonce,auto_select:false,use_fedcm_for_button:false,allowed_parent_origin:config.parentOrigin,callback:r=>send({credential:r.credential})});
  google.accounts.id.renderButton(document.getElementById('google-button'),{type:'standard',theme:'outline',size:'large',width:320});
} catch (error) {
  const message=error instanceof Error?error.message:String(error);
  document.getElementById('error').textContent=message;
  send({error:message});
}
</script></body></html>`
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${cspNonce}' https://accounts.google.com; style-src 'unsafe-inline' https://accounts.google.com; frame-src https://accounts.google.com; connect-src https://accounts.google.com; img-src https://*.googleusercontent.com data:; frame-ancestors ${parentOrigin}; base-uri 'none'; form-action 'none'`,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  })
}

function validJwks(value) {
  return Boolean(value && Array.isArray(value.keys) && value.keys.length > 0 &&
    value.keys.every(key => key && key.kty === 'RSA' && typeof key.kid === 'string' &&
      typeof key.n === 'string' && typeof key.e === 'string'))
}

export async function googleJwks(request, context) {
  const cache = caches.default
  const cacheKey = new Request(new URL(GOOGLE_JWKS_PATH, request.url), { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) return cached
  const upstream = await fetch(GOOGLE_JWKS_URL, { headers: { accept: 'application/json' } })
  if (!upstream.ok) return new Response('Google public keys unavailable', { status: 503 })
  const value = await upstream.json()
  if (!validJwks(value)) return new Response('Invalid Google public-key response', { status: 502 })
  const response = Response.json(value, {
    headers: {
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
    },
  })
  context.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}

export async function handleGoogleAuthRoute(request, env, context, config) {
  const url = new URL(request.url)
  if (url.pathname === GOOGLE_AUTH_BRIDGE_PATH) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    if (!env.VITE_GOOGLE_CLIENT_ID) return new Response('Auth bridge is not configured', { status: 503 })
    return googleAuthPreviewPage(url, env.VITE_GOOGLE_CLIENT_ID, config)
  }
  if (url.pathname === GOOGLE_JWKS_PATH) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    return googleJwks(request, context)
  }
  return null
}
