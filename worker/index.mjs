import { handleGoogleAuthRoute } from '../packages/core/worker/googleAuth.mjs'
import { issueNetworkCredentials } from '../packages/core/worker/networkCredentials.mjs'
import { lookupRendezvous } from '../packages/core/worker/rendezvous.mjs'
import { handleRealtimeRoute } from '../packages/core/worker/realtime/index.mjs'

export { UserGatewayDO, SignalScopeDO, WorkspaceDO } from '../packages/core/worker/realtime/index.mjs'

const NETWORK_CREDENTIALS_PATH = '/api/network/credentials'
const RENDEZVOUS_LOOKUP_PATH = '/api/rendezvous/lookup'

export function allowedAuthParent(origin) {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.origin === origin && (
      url.hostname === 'peerly.cc' ||
      url.hostname === 'preview.peerly.cc' ||
      /^[a-z0-9-]+\.preview\.peerly\.cc$/i.test(url.hostname) ||
      /^[a-z0-9-]+-peerly\.codefusion\.workers?\.dev$/i.test(url.hostname)
    )
  } catch {
    return false
  }
}

const authConfig = {
  allowedParent: allowedAuthParent,
  messageType: 'peerly-google-auth-credential',
  title: 'Peerly preview sign-in',
}

const realtimeConfig = { app: 'peerly', allowedOrigin: allowedAuthParent }

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url)
    if (url.pathname === NETWORK_CREDENTIALS_PATH) return issueNetworkCredentials(request, env)
    if (url.pathname === RENDEZVOUS_LOOKUP_PATH) return lookupRendezvous(request, env)
    const realtimeResponse = await handleRealtimeRoute(request, env, realtimeConfig)
    if (realtimeResponse) return realtimeResponse
    const authResponse = await handleGoogleAuthRoute(request, env, context, authConfig)
    return authResponse ?? env.ASSETS.fetch(request)
  },
}
