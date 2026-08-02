/**
 * In-memory `GatewayStorage`.
 *
 * Not a toy: this is what lets the gateway's rules be tested in plain Vitest,
 * in milliseconds, without workerd. The previous implementation could only be
 * exercised through a real Durable Object, which is why its tests reached
 * straight for the RPCs with hand-written ids — and why they all kept passing
 * while the identity those ids stood for was broken.
 *
 * Semantics here must match `adapters/durableObject/sqlGatewayStorage.ts`;
 * `gatewayStorage.contract.test.ts` runs one suite against both.
 */
import type { DeviceKeyId, OpaqueUserId } from '../../protocol/ids.js'
import type { SessionRecord } from '../../domain/deviceRegistry.js'
import type { StoredEvent, StreamEvent } from '../../domain/eventStream.js'
import type { GatewayStorage } from '../../ports/index.js'

export function createMemoryGatewayStorage(): GatewayStorage {
  let identity: OpaqueUserId | null = null
  const sessions = new Map<string, SessionRecord>()
  const epochs = new Map<DeviceKeyId, number>()
  const nonces = new Map<string, number>()
  const acks = new Map<string, { ack: string; expiresAtMs: number }>()
  const events: StoredEvent[] = []
  const mailbox = new Map<string, { body: string; createdAtMs: number }>()
  let latestSeq = 0

  return {
    identity: {
      current: () => identity,
      remember(uid) {
        identity = uid
      },
    },

    sessions: {
      all: () => [...sessions.values()],
      byId: sid => sessions.get(sid),
      insert(session) {
        sessions.set(session.sid, session)
      },
      deleteForDevice(deviceKeyId) {
        for (const [sid, session] of sessions) {
          if (session.deviceKeyId === deviceKeyId) sessions.delete(sid)
        }
      },
      deleteExpired(nowMs) {
        for (const [sid, session] of sessions) {
          if (session.expiresAtMs <= nowMs) sessions.delete(sid)
        }
      },
      epochFor: deviceKeyId => epochs.get(deviceKeyId),
      setEpoch(deviceKeyId, epoch) {
        epochs.set(deviceKeyId, epoch)
      },
    },

    nonces: {
      consume(hash, expiresAtMs) {
        if (nonces.has(hash)) return false
        nonces.set(hash, expiresAtMs)
        return true
      },
      deleteExpired(nowMs) {
        for (const [hash, expiresAtMs] of nonces) {
          if (expiresAtMs <= nowMs) nonces.delete(hash)
        }
      },
      earliestExpiryMs: () => (nonces.size === 0 ? null : Math.min(...nonces.values())),
    },

    idempotency: {
      recall: commandId => acks.get(commandId)?.ack,
      remember(commandId, ack, expiresAtMs) {
        acks.set(commandId, { ack, expiresAtMs })
      },
      deleteExpired(nowMs) {
        for (const [commandId, entry] of acks) {
          if (entry.expiresAtMs <= nowMs) acks.delete(commandId)
        }
      },
      earliestExpiryMs: () =>
        acks.size === 0 ? null : Math.min(...[...acks.values()].map(entry => entry.expiresAtMs)),
    },

    events: {
      append(incoming: readonly StreamEvent[], nowMs) {
        const appended = incoming.map(event => {
          latestSeq += 1
          return { ...event, seq: latestSeq, createdAtMs: nowMs }
        })
        events.push(...appended)
        return appended
      },
      since: seq => events.filter(event => event.seq > seq),
      oldestSeq: () => (events.length === 0 ? null : events[0].seq),
      latestSeq: () => latestSeq,
      prune(olderThanMs, keepNewest) {
        const keep = new Set(events.slice(-keepNewest).map(event => event.seq))
        for (let index = events.length - 1; index >= 0; index -= 1) {
          const event = events[index]
          if (event.createdAtMs <= olderThanMs && !keep.has(event.seq)) events.splice(index, 1)
        }
      },
    },

    mailbox: {
      put(inviteId, body, nowMs) {
        mailbox.set(inviteId, { body, createdAtMs: nowMs })
      },
      drop(inviteId) {
        mailbox.delete(inviteId)
      },
      count: () => mailbox.size,
      has: inviteId => mailbox.has(inviteId),
      oldestId() {
        let oldest: { id: string; createdAtMs: number } | null = null
        for (const [id, entry] of mailbox) {
          if (!oldest || entry.createdAtMs < oldest.createdAtMs) oldest = { id, createdAtMs: entry.createdAtMs }
        }
        return oldest?.id
      },
    },
  }
}
