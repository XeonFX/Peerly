/**
 * Client-visible subset of packages/core/worker/realtime/limits.mjs. Keep in
 * sync by hand — the server module cannot be imported here because it lives
 * outside the tsc build graph (worker code intentionally avoids depending on
 * the compiled dist/ output; see docs/DURABLE_OBJECTS_IMPLEMENTATION.md).
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
})
