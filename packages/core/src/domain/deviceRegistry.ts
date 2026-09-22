/**
 * Which devices an account may hold sessions for, and what a revocation
 * means. Pure decisions over a snapshot of stored sessions — the storage that
 * holds them is an adapter's problem.
 */
import type { DeviceKeyId } from '../protocol/ids.js'

export type SessionRecord = {
  readonly sid: string
  readonly deviceKeyId: DeviceKeyId
  readonly epoch: number
  readonly createdAtMs: number
  readonly expiresAtMs: number
}

export type EnrollmentDecision =
  | { readonly kind: 'admit'; readonly evict: DeviceKeyId | null; readonly epoch: number }

/**
 * Admit a device, evicting the least-recently-enrolled one if the account is
 * already at its cap.
 *
 * "Newest wins" rather than "reject the newcomer": sessions last 30 days and
 * clearing browser storage regenerates the device key, so a user who cleared
 * data or rotated browsers a few times would otherwise be locked out of their
 * own account until the stalest enrollment expired. Eviction is a capacity
 * bound, not a revocation — the bumped device simply re-enrolls next time, so
 * its epoch is deliberately left untouched.
 */
export function decideEnrollment(
  sessions: readonly SessionRecord[],
  deviceKeyId: DeviceKeyId,
  epochs: ReadonlyMap<DeviceKeyId, number>,
  maxDevices: number,
  nowMs: number
): EnrollmentDecision {
  const live = sessions.filter(session => session.expiresAtMs > nowMs)
  const distinct = new Set(live.map(session => session.deviceKeyId))
  const epoch = epochs.get(deviceKeyId) ?? 0

  if (distinct.has(deviceKeyId) || distinct.size < maxDevices) {
    return { kind: 'admit', evict: null, epoch }
  }

  // Oldest by most-recent enrollment, ties broken by key id so two callers
  // observing the same state always choose the same victim.
  const newestPerDevice = new Map<DeviceKeyId, number>()
  for (const session of live) {
    const seen = newestPerDevice.get(session.deviceKeyId) ?? 0
    if (session.createdAtMs > seen) newestPerDevice.set(session.deviceKeyId, session.createdAtMs)
  }
  const evict = [...newestPerDevice.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null

  return { kind: 'admit', evict, epoch }
}

/**
 * A session is valid only if it exists, belongs to this device, carries the
 * device's current epoch, and has not expired. Revocation works by bumping
 * the epoch, which invalidates every capability already issued for that
 * device without having to find and delete each one.
 */
export function isSessionValid(
  session: SessionRecord | undefined,
  deviceKeyId: DeviceKeyId,
  epoch: number,
  currentEpoch: number,
  nowMs: number
): boolean {
  if (!session) return false
  if (session.deviceKeyId !== deviceKeyId) return false
  if (session.epoch !== epoch || epoch !== currentEpoch) return false
  return session.expiresAtMs > nowMs
}

export function nextEpoch(currentEpoch: number | undefined): number {
  return (currentEpoch ?? 0) + 1
}
