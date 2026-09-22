import { describe, expect, it } from 'vitest'
import type { GatewayStorage } from '../ports/index.js'
import type { DeviceKeyId, OpaqueUserId } from '../protocol/ids.js'

/**
 * The `GatewayStorage` contract.
 *
 * Exported as a suite so the SQLite adapter can be held to exactly the same
 * behaviour under `vitest-pool-workers`. A port with two implementations and
 * one suite is the only way they stay interchangeable; two separately written
 * test files drift, and the drift shows up as a bug that reproduces in
 * production and not in tests.
 *
 * Takes a *runner* rather than a factory because a Durable Object's storage
 * handle is only valid inside `runInDurableObject`; using one afterwards
 * fails with a cross-request I/O error. The runner lets each implementation
 * decide what "inside" means.
 */
export type StorageRunner = (body: (storage: GatewayStorage) => void) => Promise<void> | void

export function describeGatewayStorageContract(
  name: string,
  withStorage: StorageRunner
): void {
  const dk = (value: string) => value as DeviceKeyId
  const uid = (value: string) => value as OpaqueUserId

  describe(`${name} — GatewayStorage contract`, () => {
    it('starts with no identity and remembers the one it is told', async () => {
      await withStorage(store => {
        expect(store.identity.current()).toBeNull()
        store.identity.remember(uid('account-1'))
        expect(store.identity.current()).toBe('account-1')
      })
    })

    it('round-trips a session and finds it by id', async () => {
      await withStorage(store => {
        const session = {
          sid: 's1', deviceKeyId: dk('device-a'), epoch: 0, createdAtMs: 1, expiresAtMs: 1_000,
        }
        store.sessions.insert(session)
        expect(store.sessions.byId('s1')).toEqual(session)
        expect(store.sessions.all()).toHaveLength(1)
      })
    })

    it('deletes every session for one device without touching the others', async () => {
      await withStorage(store => {
        store.sessions.insert({ sid: 's1', deviceKeyId: dk('a'), epoch: 0, createdAtMs: 1, expiresAtMs: 1_000 })
        store.sessions.insert({ sid: 's2', deviceKeyId: dk('a'), epoch: 0, createdAtMs: 2, expiresAtMs: 1_000 })
        store.sessions.insert({ sid: 's3', deviceKeyId: dk('b'), epoch: 0, createdAtMs: 3, expiresAtMs: 1_000 })
        store.sessions.deleteForDevice(dk('a'))
        expect(store.sessions.all().map(session => session.sid)).toEqual(['s3'])
      })
    })

    it('deletes only sessions that have actually expired', async () => {
      await withStorage(store => {
        store.sessions.insert({ sid: 's1', deviceKeyId: dk('a'), epoch: 0, createdAtMs: 1, expiresAtMs: 500 })
        store.sessions.insert({ sid: 's2', deviceKeyId: dk('b'), epoch: 0, createdAtMs: 1, expiresAtMs: 5_000 })
        store.sessions.deleteExpired(1_000)
        expect(store.sessions.all().map(session => session.sid)).toEqual(['s2'])
      })
    })

    it('tracks a device epoch, defaulting to absent rather than zero', async () => {
      await withStorage(store => {
        expect(store.sessions.epochFor(dk('a'))).toBeUndefined()
        store.sessions.setEpoch(dk('a'), 3)
        expect(store.sessions.epochFor(dk('a'))).toBe(3)
      })
    })

    it('consumes a nonce exactly once', async () => {
      await withStorage(store => {
        expect(store.nonces.consume('hash-1', 1_000)).toBe(true)
        expect(store.nonces.consume('hash-1', 1_000)).toBe(false)
        expect(store.nonces.consume('hash-2', 1_000)).toBe(true)
      })
    })

    it('prunes expired nonces and reports the next expiry', async () => {
      await withStorage(store => {
        store.nonces.consume('early', 100)
        store.nonces.consume('late', 900)
        expect(store.nonces.earliestExpiryMs()).toBe(100)
        store.nonces.deleteExpired(500)
        expect(store.nonces.earliestExpiryMs()).toBe(900)
        store.nonces.deleteExpired(1_000)
        expect(store.nonces.earliestExpiryMs()).toBeNull()
      })
    })

    it('replays a remembered ack instead of re-executing', async () => {
      await withStorage(store => {
        expect(store.idempotency.recall('cmd-1')).toBeUndefined()
        store.idempotency.remember('cmd-1', '{"ack":true}', 1_000)
        expect(store.idempotency.recall('cmd-1')).toBe('{"ack":true}')
        store.idempotency.deleteExpired(2_000)
        expect(store.idempotency.recall('cmd-1')).toBeUndefined()
      })
    })

    it('assigns strictly increasing sequences across separate appends', async () => {
      await withStorage(store => {
        const first = store.events.append([{ kind: 'ring', body: {} }], 10)
        const second = store.events.append(
          [{ kind: 'invite', body: {} }, { kind: 'invite', body: {} }],
          20
        )
        expect(first.map(event => event.seq)).toEqual([1])
        expect(second.map(event => event.seq)).toEqual([2, 3])
        expect(store.events.latestSeq()).toBe(3)
      })
    })

    it('returns only events after the cursor', async () => {
      await withStorage(store => {
        store.events.append([{ kind: 'a', body: {} }, { kind: 'b', body: {} }, { kind: 'c', body: {} }], 0)
        expect(store.events.since(1).map(event => event.kind)).toEqual(['b', 'c'])
        expect(store.events.since(3)).toHaveLength(0)
      })
    })

    it('reports no oldest sequence for an empty stream', async () => {
      await withStorage(store => {
        expect(store.events.oldestSeq()).toBeNull()
        expect(store.events.latestSeq()).toBe(0)
      })
    })

    it('keeps the newest rows when pruning, however old they are', async () => {
      // A quiet account must still be able to resume; age alone must not empty
      // the stream out from under a client that has been away.
      await withStorage(store => {
        store.events.append(
          Array.from({ length: 5 }, (_, index) => ({ kind: `e${index}`, body: {} })),
          0
        )
        store.events.prune(1_000, 2)
        expect(store.events.since(0).map(event => event.kind)).toEqual(['e3', 'e4'])
      })
    })

    it('never renumbers surviving events after a prune', async () => {
      await withStorage(store => {
        store.events.append(Array.from({ length: 4 }, () => ({ kind: 'e', body: {} })), 0)
        store.events.prune(1_000, 2)
        expect(store.events.since(0).map(event => event.seq)).toEqual([3, 4])
        expect(store.events.latestSeq()).toBe(4)
      })
    })

    it('stores mailbox entries and identifies the oldest for eviction', async () => {
      await withStorage(store => {
        store.mailbox.put('i1', '{}', 10)
        store.mailbox.put('i2', '{}', 20)
        expect(store.mailbox.count()).toBe(2)
        expect(store.mailbox.oldestId()).toBe('i1')
        store.mailbox.drop('i1')
        expect(store.mailbox.oldestId()).toBe('i2')
        expect(store.mailbox.count()).toBe(1)
      })
    })

    it('reports no oldest mailbox entry when empty', async () => {
      await withStorage(store => {
        expect(store.mailbox.oldestId()).toBeUndefined()
      })
    })
  })
}
