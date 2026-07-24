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
  statsMinPollMs: 30_000,
  commandQueueMax: 100,
  reconnectBaseMs: 250,
  reconnectCapMs: 30_000,
  /** Reject a command with no ack/error after this long — see client.ts send(). */
  commandTimeoutMs: 15_000,
})
