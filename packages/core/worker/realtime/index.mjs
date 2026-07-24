// HeyHubs-only Durable Objects (InterestQueueDO, PresenceStatsShardDO,
// RoomDirectoryShardDO) live in the HeyHubs repo, not here: they have exactly
// one consumer, so keeping them in @peerly/core would mean Peerly source
// carrying HeyHubs product code with no shared-code benefit (see
// docs/DURABLE_OBJECTS_AUDIT.md finding A1). Everything below is genuinely
// single-implementation code, shared through this package: the wire
// protocol, crypto, auth routes, rate limiting, the routing entry point, and
// UserGatewayDO/SignalScopeDO (bound by both apps). WorkspaceDO is Peerly
// only — it lives here rather than in the Peerly repo's own worker/ because,
// unlike the HeyHubs-only DOs above, it has no HeyHubs analog to draw a
// leak/no-leak line against; core is simply where all DO classes are
// implemented, HeyHubs-only ones excepted.
export { UserGatewayDO } from './userGateway.mjs'
export { SignalScopeDO } from './signalScope.mjs'
export { WorkspaceDO } from './workspace.mjs'
export { handleRealtimeRoute } from './router.mjs'
export { LIMITS } from './limits.mjs'
export { deriveScopeRouteId } from './crypto.mjs'
