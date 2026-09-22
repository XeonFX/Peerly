import { handleGoogleAuthRoute } from '../packages/core/worker/googleAuth.mjs'
import { issueNetworkCredentials } from '../packages/core/worker/networkCredentials.mjs'
import { lookupRendezvous } from '../packages/core/worker/rendezvous.mjs'
import { handleRealtimeRoute } from '../packages/core/worker/realtime/index.mjs'
import { prepareAuthenticatedRealtimeUpgrade } from '../packages/core/worker/realtime/index.mjs'
import { ContentChannelDO } from './realtime/contentChannel.mjs'
import { LobbyChannelDO } from './realtime/lobbyChannel.mjs'

export { SignalScopeDO } from '../packages/core/worker/realtime/index.mjs'
export { UserGatewayDO } from './realtime/gateway.mjs'
export { ContentChannelDO }
export { LobbyChannelDO }

const NETWORK_CREDENTIALS_PATH = '/api/network/credentials'
const RENDEZVOUS_LOOKUP_PATH = '/api/rendezvous/lookup'
const CONTENT_CHANNEL_PREFIX = '/api/realtime/content/'
const LOBBY_CHANNEL_PREFIX = '/api/realtime/lobby/'
const LOBBY_ROUTE_ID = 'peerly-lobby-v1'

export function allowedAuthParent(origin) {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.origin === origin && (
      url.hostname === 'peerly.cc' ||
      url.hostname === 'preview.peerly.cc' ||
      /^[a-z0-9-]+\.preview\.peerly\.cc$/i.test(url.hostname) ||
      // `<label>-preview.peerly.cc` alongside `<label>.preview.peerly.cc`;
      // both are staging names on our own zone. See the matching comment in
      // HeyHubs' worker/index.mjs.
      /^[a-z0-9-]+-preview\.peerly\.cc$/i.test(url.hostname) ||
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

/**
 * The browser E2E harness runs the worker on localhost over plain http, which
 * `allowedAuthParent` rejects — correctly, for anything deployed.
 *
 * So the harness names its own origin in `E2E_ALLOWED_ORIGIN`, and it is
 * matched as one exact string, never a pattern. A deployment that does not set
 * the variable allows nothing extra, which is why this can be configuration
 * rather than a build-time branch: there is no code path to disable.
 */
function originAllowedBy(env) {
  const extra = typeof env.E2E_ALLOWED_ORIGIN === 'string' ? env.E2E_ALLOWED_ORIGIN.trim() : ''
  return origin => allowedAuthParent(origin) || (extra !== '' && origin === extra)
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url)
    if (url.pathname === NETWORK_CREDENTIALS_PATH) return issueNetworkCredentials(request, env)
    if (url.pathname === RENDEZVOUS_LOOKUP_PATH) return lookupRendezvous(request, env)
    const realtimeConfig = {
      app: 'peerly',
      allowedOrigin: originAllowedBy(env),
      requirePublicUserId:
        env.CONTENT_BACKEND === 'durable-objects' ||
        env.COORDINATION_BACKEND === 'durable-objects',
      requirePrivateMemberId: env.CONTENT_BACKEND === 'durable-objects',
    }
    if (url.pathname.startsWith(LOBBY_CHANNEL_PREFIX)) {
      if (
        env.COORDINATION_BACKEND !== 'durable-objects' ||
        !env.LOBBY_CHANNELS ||
        url.pathname.slice(LOBBY_CHANNEL_PREFIX.length) !== LOBBY_ROUTE_ID
      ) {
        return Response.json(
          { code: 'service-unavailable' },
          { status: 503 }
        )
      }
      const prepared = await prepareAuthenticatedRealtimeUpgrade(
        request,
        env,
        realtimeConfig
      )
      if (prepared.error) return prepared.error
      return env.LOBBY_CHANNELS
        .getByName('peerly:public-lobby-v1')
        .fetch(prepared.request)
    }
    if (url.pathname.startsWith(CONTENT_CHANNEL_PREFIX)) {
      if (
        env.COORDINATION_BACKEND !== 'durable-objects' ||
        env.CONTENT_BACKEND !== 'durable-objects' ||
        !env.CONTENT_CHANNELS
      ) {
        return Response.json(
          { code: 'service-unavailable' },
          { status: 503 }
        )
      }
      const routeId = url.pathname.slice(CONTENT_CHANNEL_PREFIX.length)
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(routeId)) {
        return new Response('Not found', { status: 404 })
      }
      const prepared = await prepareAuthenticatedRealtimeUpgrade(
        request,
        env,
        realtimeConfig
      )
      if (prepared.error) return prepared.error
      return env.CONTENT_CHANNELS
        .getByName(`peerly:${routeId}`)
        .fetch(prepared.request)
    }
    const realtimeResponse = await handleRealtimeRoute(request, env, realtimeConfig)
    if (realtimeResponse) return realtimeResponse
    const authResponse = await handleGoogleAuthRoute(request, env, context, authConfig)
    return authResponse ?? env.ASSETS.fetch(request)
  },
}
