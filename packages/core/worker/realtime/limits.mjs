// Single source of truth for every byte/rate/count/TTL cap in the realtime
// control plane. Server code imports from here; src/realtime/limits.ts
// re-exports the subset the browser client needs. Never inline a cap
// elsewhere — a duplicated constant is how a server check and a client
// check drift.
export const LIMITS = Object.freeze({
  protocolVersion: 1,

  controlFrameBytes: 32 * 1024,
  signalFrameBytes: 16 * 1024,

  controlSocketsPerAccount: 3,
  signalSocketsPerDevice: 8,
  participantsPerScope: 16,
  // Topics one signal-socket participant may claim for routed delivery: its
  // own per-peer topic plus the room-wide one, with headroom for a rejoin
  // that has not yet dropped the previous pair.
  topicsPerParticipant: 8,

  commandsBurst: 20,
  commandsSustained: 5,
  commandsWindowMs: 10_000,
  signalsBurst: 50,
  signalsSustained: 20,
  signalsWindowMs: 10_000,

  interestsPerSeek: 5,
  interestMaxChars: 32,
  seekLeaseMs: 30 * 60_000,
  reservationMs: 30_000,
  matchCooldownMs: 10 * 60_000,

  directoryPageEntries: 50,
  directoryPayloadBytes: 8 * 1024,
  directoryMaxRoomsPerShard: 1000,
  // Independent from seekLeaseMs on purpose: a public-room announcement is a
  // different kind of thing than a matchmaking seek, and changing one must
  // not silently change how long the other lives. Renewed by client republish.
  directoryEntryTtlMs: 60 * 60_000,

  mailboxEntries: 100,
  idempotencyTtlMs: 24 * 60 * 60_000,

  eventRetentionRows: 1000,
  eventRetentionMs: 24 * 60 * 60_000,

  nonceTtlMs: 2 * 60_000,
  cookieTtlMs: 10 * 60_000,
  capabilityTtlMs: 30 * 24 * 60 * 60_000,
  scopeAuthorizationTtlMs: 10 * 60_000,

  presenceLeaseMs: 60 * 60_000,
  // Edge-cache window for /api/stats/snapshot. This is the floor on how long
  // one person's newly-announced interest stays invisible to everyone else,
  // so it is deliberately short: at 30s, two people who picked the same
  // interest seconds apart could each see the other's count as 0 for most of
  // a minute and conclude discovery was broken.
  statsCacheSeconds: 10,
  statsMinPollMs: 10_000,

  attachmentBytes: 2048,

  batchWindowMs: 75,
  batchMaxEvents: 20,
  batchMaxBytes: 16 * 1024,

  shardCount: 1,

  maxRequestBodyBytes: 16 * 1024,
  maxTokenStringBytes: 16_000,
})
