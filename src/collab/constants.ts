export const ALONE_WARNING_MS = 20_000
export const HISTORY_REQUEST_TIMEOUT_MS = 20_000
export const CONNECTION_POLL_MS = 2_000

/** Largest file accepted for send or receive. Whole files are held in memory. */
/**
 * Longest chat message accepted, in UTF-16 code units. Enforced at send AND on
 * every receive/import path: without the receive-side clamp a peer could push
 * megabyte strings straight into everyone's React state and localStorage
 * (quota-exhaustion griefing, and history persistence dies unhandled).
 */
export const MAX_MESSAGE_CHARS = 8_000

export const MAX_FILE_BYTES = 50 * 1024 * 1024

/** Total resident file-buffer budget; past this, buffers fall back to IndexedDB. */
export const MAX_CACHED_FILE_BYTES = 150 * 1024 * 1024

/** Per-channel cap on retained/served history, oldest dropped first. */
export const MAX_HISTORY_ENTRIES = 500

/** Cap on file ids a peer may ask for in one request. */
export const MAX_FILE_REQUEST_IDS = 200

/**
 * Wait between asking successive peers for the same files. Peers in a workspace
 * almost always hold every file, so the first one asked normally answers; this
 * pause lets that land so we don't pull N copies of every file from N peers.
 */
export const FILE_REQUEST_STAGGER_MS = 1_500

export const FILE_TOO_LARGE_ERROR = `Files must be smaller than ${
  MAX_FILE_BYTES / (1024 * 1024)
} MB.`

export const RELAY_OFFLINE_ERROR =
  'Nostr signaling is offline. Check your internet connection and try again.'

export const ALONE_WARNING_NOTICE =
  'No teammates found yet. Confirm your invite link, channel, and sign-in.'