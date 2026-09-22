import { describe, expect, it } from 'vitest'
import {
  addToBatch, createBucket, decideEnrollment, EMPTY_BATCH, expiredLease, isLastSocket,
  isSessionValid, leaseFor, nextEpoch, planResume, renewAtMs, retentionCutoff, shouldFlush, take,
  type SessionRecord,
} from './index.js'
import { LIMITS } from '../protocol/limits.js'
import type { DeviceKeyId } from '../protocol/ids.js'

const dk = (value: string) => value as DeviceKeyId
const policy = { burst: 3, sustainedPerSecond: 1 }

describe('token bucket', () => {
  it('allows a burst then refuses', () => {
    let bucket = createBucket(policy, 0)
    for (let i = 0; i < 3; i += 1) {
      const result = take(bucket, policy, 0)
      expect(result.allowed).toBe(true)
      bucket = result.bucket
    }
    expect(take(bucket, policy, 0).allowed).toBe(false)
  })

  it('refills at the sustained rate and never past the burst ceiling', () => {
    let bucket = createBucket(policy, 0)
    for (let i = 0; i < 3; i += 1) bucket = take(bucket, policy, 0).bucket
    expect(take(bucket, policy, 1_000).allowed).toBe(true)

    const idle = take(createBucket(policy, 0), policy, 3_600_000)
    expect(idle.bucket.tokens).toBeCloseTo(policy.burst - 1)
  })

  it('mints nothing when the clock goes backwards', () => {
    let bucket = createBucket(policy, 10_000)
    for (let i = 0; i < 3; i += 1) bucket = take(bucket, policy, 10_000).bucket
    expect(take(bucket, policy, 0).allowed).toBe(false)
  })

  it('reports how long until a token is available', () => {
    let bucket = createBucket(policy, 0)
    for (let i = 0; i < 3; i += 1) bucket = take(bucket, policy, 0).bucket
    expect(take(bucket, policy, 0).retryAfterMs).toBe(1_000)
  })
})

describe('device enrollment', () => {
  const session = (id: string, device: string, createdAtMs: number): SessionRecord => ({
    sid: id, deviceKeyId: dk(device), epoch: 0, createdAtMs, expiresAtMs: 10_000,
  })

  it('admits a new device below the cap without evicting', () => {
    const decision = decideEnrollment([session('s1', 'a', 1)], dk('b'), new Map(), 3, 0)
    expect(decision.evict).toBeNull()
  })

  it('evicts the least-recently-enrolled device at the cap, not the newcomer', () => {
    // Sessions last 30 days and clearing storage regenerates the device key,
    // so rejecting the newcomer locks a returning user out of their own
    // account until the stalest enrollment expires.
    const sessions = [session('s1', 'a', 1), session('s2', 'b', 2), session('s3', 'c', 3)]
    expect(decideEnrollment(sessions, dk('d'), new Map(), 3, 0).evict).toBe('a')
  })

  it('re-enrolling a device already present never evicts', () => {
    const sessions = [session('s1', 'a', 1), session('s2', 'b', 2), session('s3', 'c', 3)]
    expect(decideEnrollment(sessions, dk('b'), new Map(), 3, 0).evict).toBeNull()
  })

  it('ignores expired sessions when counting devices', () => {
    const expired: SessionRecord = { ...session('s1', 'a', 1), expiresAtMs: 5 }
    const sessions = [expired, session('s2', 'b', 2), session('s3', 'c', 3)]
    expect(decideEnrollment(sessions, dk('d'), new Map(), 3, 10).evict).toBeNull()
  })

  it('breaks an eviction tie deterministically so two callers agree', () => {
    const sessions = [session('s1', 'b', 5), session('s2', 'a', 5), session('s3', 'c', 9)]
    expect(decideEnrollment(sessions, dk('d'), new Map(), 3, 0).evict).toBe('a')
  })

  it('carries the device its existing epoch, since eviction is not revocation', () => {
    const epochs = new Map([[dk('a'), 4]])
    expect(decideEnrollment([], dk('a'), epochs, 3, 0).epoch).toBe(4)
  })
})

describe('session validity', () => {
  const live: SessionRecord = {
    sid: 's1', deviceKeyId: dk('a'), epoch: 2, createdAtMs: 0, expiresAtMs: 1_000,
  }

  it('accepts a live session on its current epoch', () => {
    expect(isSessionValid(live, dk('a'), 2, 2, 0)).toBe(true)
  })

  it.each([
    ['missing', undefined, dk('a'), 2, 2, 0],
    ['another device', live, dk('b'), 2, 2, 0],
    ['stale epoch after revocation', live, dk('a'), 2, 3, 0],
    ['expired', live, dk('a'), 2, 2, 2_000],
  ])('rejects %s', (_label, session, device, epoch, current, now) => {
    expect(isSessionValid(session as SessionRecord | undefined, device, epoch, current, now)).toBe(false)
  })

  it('bumps the epoch on revocation, invalidating capabilities already issued', () => {
    expect(nextEpoch(undefined)).toBe(1)
    expect(nextEpoch(7)).toBe(8)
  })
})

describe('resume planning', () => {
  it('sends only what the client is missing', () => {
    expect(planResume(5, 1, 9)).toEqual({ kind: 'delta', fromSeq: 5 })
  })

  it('says nothing when the client is already current', () => {
    expect(planResume(9, 1, 9)).toEqual({ kind: 'up-to-date' })
  })

  it('re-seeds when retention has passed the cursor', () => {
    // The gap can never be filled event by event, so a delta would silently
    // skip history the client has never seen.
    expect(planResume(2, 40, 90)).toEqual({ kind: 'snapshot' })
  })

  it('re-seeds a cursor from the future rather than sending nothing', () => {
    expect(planResume(500, 1, 9)).toEqual({ kind: 'snapshot' })
  })

  it('re-seeds a nonsense cursor', () => {
    expect(planResume(Number.NaN, 1, 9)).toEqual({ kind: 'snapshot' })
    expect(planResume(-1, 1, 9)).toEqual({ kind: 'snapshot' })
  })

  it('treats a fresh account as up to date rather than replaying', () => {
    expect(planResume(0, null, 0)).toEqual({ kind: 'up-to-date' })
  })
})

describe('delta batching', () => {
  const event = (seq: number) => ({ kind: 'ring', body: { seq }, seq, createdAtMs: 0 })

  it('holds an event open for the batch window', () => {
    const batch = addToBatch(EMPTY_BATCH, event(1), 0)
    expect(shouldFlush(batch, 10)).toBe(false)
    expect(shouldFlush(batch, LIMITS.batchWindowMs)).toBe(true)
  })

  it('flushes early once the item cap is reached', () => {
    let batch = EMPTY_BATCH
    for (let i = 0; i < LIMITS.batchMaxEvents; i += 1) batch = addToBatch(batch, event(i), 0)
    expect(shouldFlush(batch, 0)).toBe(true)
  })

  it('flushes early once the byte cap is reached', () => {
    let batch = EMPTY_BATCH
    const fat = { kind: 'sync.notice', body: { blob: 'x'.repeat(4_000) }, seq: 1, createdAtMs: 0 }
    for (let i = 0; i < 5; i += 1) batch = addToBatch(batch, fat, 0)
    expect(batch.bytes).toBeGreaterThanOrEqual(LIMITS.batchMaxBytes)
    expect(shouldFlush(batch, 0)).toBe(true)
  })

  it('never flushes an empty batch', () => {
    expect(shouldFlush(EMPTY_BATCH, 1_000_000)).toBe(false)
  })

  it('dates the window from the first event, not the last', () => {
    let batch = addToBatch(EMPTY_BATCH, event(1), 0)
    batch = addToBatch(batch, event(2), 50)
    expect(batch.openedAtMs).toBe(0)
  })
})

describe('presence leases', () => {
  it('renews at half life, inside the lease it is renewing', () => {
    expect(renewAtMs(0)).toBeLessThan(leaseFor(0).expiresAtMs)
  })

  it('expires immediately on a clean close so the count drops promptly', () => {
    expect(expiredLease(1_000).expiresAtMs).toBe(1_000)
  })

  it('treats the closing socket as gone when deciding the account is offline', () => {
    // The runtime still lists the closing socket when the handler runs, so
    // counting the raw list means the account never goes offline.
    const closing = { id: 'a' }
    expect(isLastSocket([closing], closing)).toBe(true)
    expect(isLastSocket([closing, { id: 'b' }], closing)).toBe(false)
  })
})

describe('retention', () => {
  it('keeps the newest rows regardless of age, so a quiet account can resume', () => {
    const cutoff = retentionCutoff(1_000_000)
    expect(cutoff.keepNewest).toBe(LIMITS.eventRetentionRows)
    expect(cutoff.olderThanMs).toBe(1_000_000 - LIMITS.eventRetentionMs)
  })
})
