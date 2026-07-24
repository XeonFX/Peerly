/**
 * Client-visible subset of packages/core/worker/realtime/limits.mjs.
 *
 * These values are declared here, not imported from the server module,
 * because `tsc -b` (rootDir: "src") refuses to compile a file that reaches
 * outside `src/` — and `worker/realtime/limits.mjs` intentionally does not
 * depend on the compiled `dist/` output, so there is no direction either
 * side can import the other without violating one of those two constraints
 * (see docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 1).
 *
 * This is NOT "keep in sync by hand and hope": `limits.consistency.test.ts`
 * (excluded from the tsc build, so it's free to cross-import both files)
 * asserts every key below equals its counterpart in `LIMITS` and fails CI on
 * any drift. Add a new shared value to both files, then add its key to that
 * test's `SHARED_KEYS` list.
 */
export const CLIENT_LIMITS = Object.freeze({
  protocolVersion: 1,
  controlFrameBytes: 32 * 1024,
  signalFrameBytes: 16 * 1024,
  interestsPerSeek: 5,
  directoryPageEntries: 50,
  statsMinPollMs: 10_000,
  commandQueueMax: 100,
  reconnectBaseMs: 250,
  reconnectCapMs: 30_000,
  /** Reject a command with no ack/error after this long — see client.ts send(). */
  commandTimeoutMs: 15_000,
  /**
   * Re-run `/api/network/session` this often while connected. Must stay
   * comfortably below the server's `cookieTtlMs` (10 min), because that one
   * TTL governs two things that expire silently on a long-lived control
   * socket: the `pnet` cookie every *new* signal-socket upgrade is
   * authenticated with, and the TURN REST credential handed to Trystero. A
   * tab that stayed connected past it could no longer open a room's signal
   * socket (401) and offered peers TURN credentials coturn had already
   * expired — which surfaces as "could not connect after exchanging SDP".
   */
  sessionRefreshMs: 4 * 60_000,
  /**
   * Application-level keepalive on the control socket. The gateway answers it
   * from `setWebSocketAutoResponse` without waking the object, and it keeps
   * intermediaries from dropping an idle socket (a drop the client only
   * notices minutes later, with every queued command stalled until then).
   */
  pingIntervalMs: 45_000,
})
