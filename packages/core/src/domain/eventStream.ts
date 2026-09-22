/**
 * The per-account event stream: sequencing, what a resuming client is owed,
 * and how deltas are batched before they go out.
 */
import { LIMITS } from '../protocol/limits.js'

export type StreamEvent = {
  readonly kind: string
  readonly body: Record<string, unknown>
}

export type StoredEvent = StreamEvent & { readonly seq: number; readonly createdAtMs: number }

/**
 * What to send a client that asked to resume from `fromSeq`.
 *
 * `snapshot` when the cursor is older than anything retained — the client
 * cannot be caught up event by event, so it must be re-seeded. That branch
 * was previously unreachable: the cursor lived only in memory, so every page
 * load resumed from 0, and 0 always compared as "not aged out", which meant
 * the gateway replayed its entire 24-hour retention instead.
 */
export type ResumePlan =
  | { readonly kind: 'delta'; readonly fromSeq: number }
  | { readonly kind: 'snapshot' }
  | { readonly kind: 'up-to-date' }

export function planResume(
  fromSeq: number,
  oldestRetainedSeq: number | null,
  latestSeq: number
): ResumePlan {
  if (!Number.isFinite(fromSeq) || fromSeq < 0) return { kind: 'snapshot' }
  // A cursor ahead of the stream means a client from another object's history
  // (or a corrupted one); re-seed rather than silently sending nothing.
  if (fromSeq > latestSeq) return { kind: 'snapshot' }
  if (fromSeq === latestSeq) return { kind: 'up-to-date' }
  if (oldestRetainedSeq === null) return { kind: 'up-to-date' }
  // Retention has passed the cursor: the gap can never be filled.
  if (fromSeq < oldestRetainedSeq - 1) return { kind: 'snapshot' }
  return { kind: 'delta', fromSeq }
}

export function assignSequence(latestSeq: number, events: readonly StreamEvent[]): {
  readonly assigned: readonly StoredEvent[]
  readonly latestSeq: number
} {
  let seq = latestSeq
  const assigned = events.map(event => {
    seq += 1
    return { ...event, seq, createdAtMs: 0 }
  })
  return { assigned, latestSeq: seq }
}

/**
 * Delta batching.
 *
 * The architecture's cost model requires coalescing non-urgent deltas for
 * 50–100 ms under hard item and byte caps; the constants existed but nothing
 * read them, so every event was its own send. This decides when a pending
 * batch must go out, and the caller owns the timer.
 */
export type BatchState = {
  readonly events: readonly StoredEvent[]
  readonly bytes: number
  readonly openedAtMs: number
}

export const EMPTY_BATCH: BatchState = { events: [], bytes: 0, openedAtMs: 0 }

export function addToBatch(batch: BatchState, event: StoredEvent, nowMs: number): BatchState {
  const bytes = batch.bytes + JSON.stringify(event).length
  return {
    events: [...batch.events, event],
    bytes,
    openedAtMs: batch.events.length === 0 ? nowMs : batch.openedAtMs,
  }
}

export function shouldFlush(batch: BatchState, nowMs: number): boolean {
  if (batch.events.length === 0) return false
  if (batch.events.length >= LIMITS.batchMaxEvents) return true
  if (batch.bytes >= LIMITS.batchMaxBytes) return true
  return nowMs - batch.openedAtMs >= LIMITS.batchWindowMs
}

/** Rows to drop: older than the retention window, but never the newest N,
 *  so a quiet account keeps a usable resume history regardless of age. */
export function retentionCutoff(nowMs: number): { readonly olderThanMs: number; readonly keepNewest: number } {
  return { olderThanMs: nowMs - LIMITS.eventRetentionMs, keepNewest: LIMITS.eventRetentionRows }
}
