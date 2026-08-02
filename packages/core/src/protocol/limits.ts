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

  /** Concurrent control sockets one account may hold — browser tabs, not
   *  devices. Kept separate from `devicesPerAccount`: these were one constant,
   *  so "a fourth tab" and "a fourth device" were the same event and raising
   *  either ceiling silently raised the other. */
  controlSocketsPerAccount: 3,
  /** Devices that may hold a live session. Four is the ordinary shape of one
   *  person's hardware — phone, laptop, desktop, work laptop. */
  devicesPerAccount: 4,
  signalSocketsPerDevice: 8,
  participantsPerScope: 16,
  /** Topics one signal participant may claim for routed delivery. */
  topicsPerParticipant: 8,

  commandsBurst: 20,
  commandsSustained: 5,
  signalsBurst: 50,
  signalsSustained: 20,

  /**
   * Deliveries one socket may aim at a single recipient.
   *
   * `invite.send` and `ring.send` name their target, so without a per-target
   * ceiling the command budget above could be spent entirely on one victim:
   * enough to evict a full mailbox in about twenty seconds and to bill the
   * account for every write. Deliberately small — legitimate use is one invite
   * or one ring, not a stream.
   */
  deliveriesBurstPerRecipient: 5,
  deliveriesSustainedPerRecipient: 0.2,
  /** Distinct recipients one socket may address before the oldest bucket is
   *  recycled. Bounds the memory the limiter itself can be made to hold. */
  deliveryRecipientsTracked: 64,

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
  /**
   * How long a directory watch survives without renewal.
   *
   * Watches replace the 30-second `directory.list` poll, which was the largest
   * per-tab cost in the system. A lease rather than a subscription because the
   * shard cannot observe a browser tab closing: an abandoned watch has to stop
   * costing on its own.
   */
  directoryWatchTtlMs: 15 * 60_000,
  /** Watchers one shard will fan a change out to. Beyond this the shard stops
   *  promising push and the client's renewal falls back to reading. */
  directoryWatchersPerShard: 200,
  /** Changes are coalesced for this long before one notification goes out, so
   *  a busy lobby costs one fan-out per window rather than one per publish. */
  directoryChangeWindowMs: 2_000,

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
  /**
   * Governs the network cookie *and* the TURN credential minted beside it,
   * so anything holding either must refresh well inside this window.
   *
   * Thirty minutes rather than ten: the refresh costs a Durable Object call,
   * and at ten it was the largest fixed per-tab cost in the system. Device
   * revocation does not weaken, because a socket is admitted against the
   * session epoch in storage (`GatewayRuntime.accept`), not against the
   * cookie's own lifetime.
   */
  cookieTtlMs: 30 * 60_000,
  /** Requests one device may make to the enrol/session endpoints per minute.
   *  A healthy client spends one per `sessionRefreshMs`; this is the ceiling
   *  that stops a broken one from spending an account's daily quota. */
  authRequestsPerMinute: 10,
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
