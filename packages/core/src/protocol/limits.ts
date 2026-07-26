/**
 * Every byte, rate, count and TTL cap in the realtime control plane.
 *
 * One declaration, imported by both the browser client and the Worker. The
 * previous split — `worker/realtime/limits.mjs` plus a hand-copied
 * `src/realtime/limits.ts` whose own comment admitted "keep in sync by hand"
 * — put security-relevant constants in two places and relied on a drift test
 * to notice. That was a build-configuration workaround, not a design.
 *
 * Adding a limit here is not enough: `limits.enforcement.test.ts` fails for
 * any key with no test proving it is enforced somewhere. Four caps in the
 * previous implementation (`signalSocketsPerDevice`, `attachmentBytes`, and
 * the delta-batching trio) were declared and never read by any code.
 */
export const LIMITS = {
  protocolVersion: 1,

  /** Frame sizes. Checked twice: cheap UTF-16 length, then encoded bytes. */
  controlFrameBytes: 32 * 1024,
  signalFrameBytes: 16 * 1024,
  /** Hard runtime cap on a serialized WebSocket attachment. Exceeding it
   *  throws inside the message handler, which loses the socket. */
  attachmentBytes: 2048,

  controlSocketsPerAccount: 3,
  signalSocketsPerDevice: 8,
  participantsPerScope: 16,
  /** Topics one signal participant may claim for routed delivery. */
  topicsPerParticipant: 8,

  commandsBurst: 20,
  commandsSustained: 5,
  signalsBurst: 50,
  signalsSustained: 20,

  interestsPerSeek: 5,
  interestMaxChars: 32,
  exclusionsPerSeek: 50,
  seekLeaseMs: 30 * 60_000,
  reservationMs: 30_000,
  matchCooldownMs: 10 * 60_000,

  directoryPageEntries: 50,
  directoryPayloadBytes: 8 * 1024,
  directoryMaxRoomsPerShard: 1000,
  /** Per-account share of a shard, so one publisher cannot fill it and lock
   *  every other account out with `cap-exceeded`. */
  directoryMaxRoomsPerOwner: 20,
  directoryEntryTtlMs: 60 * 60_000,

  mailboxEntries: 100,
  idempotencyTtlMs: 24 * 60 * 60_000,

  eventRetentionRows: 1000,
  eventRetentionMs: 24 * 60 * 60_000,
  /** Deltas are coalesced for this long before a send, bounded by the two
   *  caps below. Incoming socket messages bill in groups; unbatched per-event
   *  sends were the cost model's single largest avoidable line item. */
  batchWindowMs: 75,
  batchMaxEvents: 20,
  batchMaxBytes: 16 * 1024,

  nonceTtlMs: 2 * 60_000,
  /** Governs the network cookie *and* the TURN credential minted beside it,
   *  so anything holding either must refresh well inside this window. */
  cookieTtlMs: 10 * 60_000,
  capabilityTtlMs: 30 * 24 * 60 * 60_000,
  scopeAuthorizationTtlMs: 10 * 60_000,

  presenceLeaseMs: 60 * 60_000,
  statsCacheSeconds: 10,

  shardCount: 1,

  maxRequestBodyBytes: 16 * 1024,
  maxTokenStringBytes: 16_000,
} as const

export type Limits = typeof LIMITS

/** Client-side pacing, derived from the server caps above rather than guessed.
 *  Both sessions and TURN credentials expire at `cookieTtlMs`; refreshing at a
 *  third of that survives two consecutive failures. */
export const CLIENT_TIMINGS = {
  sessionRefreshMs: Math.floor(LIMITS.cookieTtlMs / 3),
  pingIntervalMs: 45_000,
  commandTimeoutMs: 15_000,
  commandQueueMax: 100,
  reconnectBaseMs: 250,
  reconnectCapMs: 30_000,
  resumeSaveDebounceMs: 2_000,
} as const
