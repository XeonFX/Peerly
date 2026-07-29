// Product-specific Durable Objects live in their consumer repositories. This
// package contains only reusable control-plane primitives: the wire protocol,
// crypto, auth routes, rate limiting, routing entry point, and shared gateway
// and signal-scope implementations.
//
// A third class, WorkspaceDO, used to live here. It was never reachable — no
// command, no dispatch branch, no route — and wiring it up would have moved
// workspace membership and presence onto the server, which is the opposite of
// what this product is. Deleted rather than left dormant: a Durable Object
// class in an applied migration is permanent, and adding one back later is
// the easy direction.
export { defineUserGateway, UserGatewayDO } from './gateway/userGateway.mjs'
export { SignalScopeDO } from './gateway/signalScope.mjs'
export { defineAuthorizedChannel } from './gateway/authorizedChannel.mjs'
export { defineEphemeralChannel } from './gateway/ephemeralChannel.mjs'
export {
  handleRealtimeRoute,
  prepareAuthenticatedRealtimeUpgrade,
} from './router.mjs'
export { LIMITS } from '../../dist/protocol/index.js'
export { derivePrivateMemberId, deriveScopeRouteId } from './crypto.mjs'
