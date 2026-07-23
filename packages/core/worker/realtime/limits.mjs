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

  commandsBurst: 20,
  commandsSustained: 5,
  commandsWindowMs: 10_000,
  signalsBurst: 50,
  signalsSustained: 20,
  signalsWindowMs: 10_000,

  interestsPerSeek: 5,
  seekLeaseMs: 30 * 60_000,
  reservationMs: 30_000,
  matchCooldownMs: 10 * 60_000,

  directoryPageEntries: 50,
  directoryPayloadBytes: 8 * 1024,
  directoryMaxRoomsPerShard: 1000,

  mailboxEntries: 100,
  idempotencyTtlMs: 24 * 60 * 60_000,

  eventRetentionRows: 1000,
  eventRetentionMs: 24 * 60 * 60_000,

  nonceTtlMs: 2 * 60_000,
  cookieTtlMs: 10 * 60_000,
  capabilityTtlMs: 30 * 24 * 60 * 60_000,
  scopeAuthorizationTtlMs: 10 * 60_000,

  presenceLeaseMs: 60 * 60_000,
  statsCacheSeconds: 30,
  statsMinPollMs: 30_000,

  attachmentBytes: 2048,

  batchWindowMs: 75,
  batchMaxEvents: 20,
  batchMaxBytes: 16 * 1024,

  shardCount: 1,

  maxRequestBodyBytes: 16 * 1024,
  maxTokenStringBytes: 16_000,
})
