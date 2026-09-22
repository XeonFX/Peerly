/**
 * Identifier types and minting.
 *
 * The branded types are not ceremony. Two bugs this rewrite designs out were
 * both "the right string in the wrong id space":
 *
 *  - Seek exclusions were compared against the server's `OpaqueUserId` while
 *    the app wrote them as `MemberId`s, so no blocklist excluded anybody.
 *  - A gateway derived its `OpaqueUserId` by parsing its own Durable Object
 *    id, which is `undefined` inside the object, so every account collapsed
 *    onto the same empty string.
 *
 * With distinct nominal types the first is a compile error, and the second
 * has no constructor to call — an `OpaqueUserId` can only arrive from an
 * authenticated caller.
 */

declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

/** Deployment-scoped HMAC of issuer+subject. Never reversible, never logged
 *  beside the inputs that produced it. Server-side identity. */
export type OpaqueUserId = Brand<string, 'OpaqueUserId'>

/** An id in the *application's* own space, derivable by any client that can
 *  already name the user. What blocklists and exclusion lists are written in;
 *  the server only ever compares it for equality. */
export type MemberId = Brand<string, 'MemberId'>

/** `P-256:<x>:<y>` public key id of one device. */
export type DeviceKeyId = Brand<string, 'DeviceKeyId'>

/** Opaque signalling route, HMAC-derived from (app, kind, capability). */
export type RouteId = Brand<string, 'RouteId'>

const DEVICE_KEY_PATTERN = /^P-256:[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{20,}$/
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Parsers, not casts. Each returns `null` rather than throwing so callers at
 * a trust boundary handle bad input explicitly instead of by exception.
 */
export function asOpaqueUserId(value: unknown): OpaqueUserId | null {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value) ? (value as OpaqueUserId) : null
}

export function asMemberId(value: unknown): MemberId | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? (value as MemberId)
    : null
}

export function asDeviceKeyId(value: unknown): DeviceKeyId | null {
  return typeof value === 'string' && DEVICE_KEY_PATTERN.test(value) ? (value as DeviceKeyId) : null
}

export function asRouteId(value: unknown): RouteId | null {
  return typeof value === 'string' && ROUTE_ID_PATTERN.test(value) ? (value as RouteId) : null
}

/** Frame ids must be unique within an account, not merely within a tab. */
export interface IdSource {
  next(): string
}

const FRAME_ID_PATTERN = /^[\w-]{1,64}$/

/**
 * Per-client id source.
 *
 * The previous implementation minted `${Date.now().toString(36)}-${counter}`
 * with the counter starting at zero on every page load. The gateway keys its
 * idempotency table on that id, per account, for 24 hours — so two devices of
 * one account that loaded together and issued their n-th command in the same
 * millisecond produced the same id, and the second silently received the
 * first's cached ack instead of executing. The random prefix is what makes
 * the id unique per client rather than per millisecond.
 */
export function createIdSource(randomPrefix: () => string = defaultPrefix): IdSource {
  const prefix = randomPrefix()
  let counter = 0
  return {
    next() {
      counter += 1
      return `${prefix}-${counter.toString(36)}`
    },
  }
}

function defaultPrefix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function isValidFrameId(value: unknown): value is string {
  return typeof value === 'string' && FRAME_ID_PATTERN.test(value)
}
