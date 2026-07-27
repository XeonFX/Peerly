// HeyHubs-only Durable Objects (InterestQueueDO, PresenceStatsShardDO,
// RoomDirectoryShardDO) live in the HeyHubs repo, not here: they have exactly
// one consumer, so keeping them in @peerly/core would mean Peerly source
// carrying HeyHubs product code with no shared-code benefit (see
// docs/DURABLE_OBJECTS_AUDIT.md finding A1). Everything below is genuinely
// single-implementation code, shared through this package: the wire
// protocol, crypto, auth routes, rate limiting, the routing entry point, and
// UserGatewayDO/SignalScopeDO (bound by both apps).
//
// A third class, WorkspaceDO, used to live here. It was never reachable — no
// command, no dispatch branch, no route — and wiring it up would have moved
// workspace membership and presence onto the server, which is the opposite of
// what this product is. Deleted rather than left dormant: a Durable Object
// class in an applied migration is permanent, and adding one back later is
// the easy direction.
export { defineUserGateway, UserGatewayDO } from './gateway/userGateway.mjs'
export { SignalScopeDO } from './gateway/signalScope.mjs'
export { handleRealtimeRoute } from './router.mjs'
export { LIMITS } from '../../dist/protocol/index.js'
export { deriveScopeRouteId } from './crypto.mjs'
