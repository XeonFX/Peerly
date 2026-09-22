/**
 * Coarse online presence, expressed as an expiring lease rather than a
 * heartbeat.
 *
 * A heartbeat would keep the object awake, and one continuously active
 * Durable Object costs roughly 10,800 GB-s/day — 83% of the entire free
 * duration allowance for a single account. So presence is written on connect,
 * renewed at half life from an alarm that would be running anyway, and
 * expired immediately on a clean close.
 */
import { LIMITS } from '../protocol/limits.js'

export type PresenceLease = {
  readonly expiresAtMs: number
}

export function leaseFor(nowMs: number): PresenceLease {
  return { expiresAtMs: nowMs + LIMITS.presenceLeaseMs }
}

/** An already-expired lease: the last clean close drops the count promptly
 *  instead of leaving a ghost online for the rest of the lease. */
export function expiredLease(nowMs: number): PresenceLease {
  return { expiresAtMs: nowMs }
}

export function renewAtMs(nowMs: number): number {
  return nowMs + Math.floor(LIMITS.presenceLeaseMs / 2)
}

/**
 * Whether the account still has a socket once `closing` is accounted for.
 *
 * The closing socket is usually still listed by the runtime when the close
 * handler runs, so counting the raw list makes "the last socket closed" look
 * like "a socket remains" and the account never goes offline. Two objects in
 * the previous implementation disagreed about this; making it one named rule
 * is what stops them drifting apart again.
 */
export function isLastSocket(sockets: readonly unknown[], closing: unknown): boolean {
  return sockets.filter(socket => socket !== closing).length === 0
}
