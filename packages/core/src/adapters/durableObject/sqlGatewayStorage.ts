/**
 * `GatewayStorage` over a Durable Object's SQLite.
 *
 * Held to the same exported contract as the in-memory adapter, run against
 * real workerd. Two implementations behind one port only stay interchangeable
 * if one suite proves it; separately written tests drift, and the drift shows
 * up as a bug that reproduces in production and not in CI.
 */
import type { DeviceKeyId, OpaqueUserId } from '../../protocol/ids.js'
import type { SessionRecord } from '../../domain/deviceRegistry.js'
import type { StoredEvent, StreamEvent } from '../../domain/eventStream.js'
import type { GatewayStorage } from '../../ports/index.js'

/** The slice of the runtime's SQL API this adapter needs. Narrow on purpose:
 *  it documents the dependency and keeps the adapter honest about using
 *  nothing else. */
export interface SqlExecutor {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): { toArray(): T[] }
}

export const GATEWAY_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY, dk TEXT NOT NULL, epoch INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_dk ON sessions(dk);
CREATE TABLE IF NOT EXISTS device_epochs (dk TEXT PRIMARY KEY, epoch INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS nonces_exp ON nonces(expires_at);
CREATE TABLE IF NOT EXISTS idempotency (
  cmd_id TEXT PRIMARY KEY, ack TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idem_exp ON idempotency(expires_at);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS events_created ON events(created_at);
CREATE TABLE IF NOT EXISTS mailbox (
  invite_id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mailbox_created ON mailbox(created_at);
`

type SessionRow = {
  sid: string
  dk: string
  epoch: number
  created_at: number
  expires_at: number
}

const toSession = (row: SessionRow): SessionRecord => ({
  sid: row.sid,
  deviceKeyId: row.dk as DeviceKeyId,
  epoch: row.epoch,
  createdAtMs: row.created_at,
  expiresAtMs: row.expires_at,
})

export function createSqlGatewayStorage(sql: SqlExecutor): GatewayStorage {
  const meta = (key: string): string | undefined =>
    sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value

  const setMeta = (key: string, value: string): void => {
    sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value)
  }

  return {
    identity: {
      current: () => (meta('uid') as OpaqueUserId | undefined) ?? null,
      remember(uid) {
        setMeta('uid', uid)
      },
    },

    sessions: {
      all: () => sql.exec<SessionRow>('SELECT * FROM sessions').toArray().map(toSession),
      byId(sid) {
        const row = sql.exec<SessionRow>('SELECT * FROM sessions WHERE sid = ?', sid).toArray()[0]
        return row ? toSession(row) : undefined
      },
      insert(session) {
        sql.exec(
          `INSERT OR REPLACE INTO sessions (sid, dk, epoch, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          session.sid, session.deviceKeyId, session.epoch, session.createdAtMs, session.expiresAtMs
        )
      },
      deleteForDevice(deviceKeyId) {
        sql.exec('DELETE FROM sessions WHERE dk = ?', deviceKeyId)
      },
      deleteExpired(nowMs) {
        sql.exec('DELETE FROM sessions WHERE expires_at <= ?', nowMs)
      },
      epochFor(deviceKeyId) {
        return sql.exec<{ epoch: number }>(
          'SELECT epoch FROM device_epochs WHERE dk = ?', deviceKeyId
        ).toArray()[0]?.epoch
      },
      setEpoch(deviceKeyId, epoch) {
        sql.exec('INSERT OR REPLACE INTO device_epochs (dk, epoch) VALUES (?, ?)', deviceKeyId, epoch)
      },
    },

    nonces: {
      consume(hash, expiresAtMs) {
        // The primary key is the single-use guarantee: a duplicate raises
        // rather than silently replacing, so replay detection cannot be lost
        // to a read-then-write race inside one storage operation.
        try {
          sql.exec('INSERT INTO nonces (hash, expires_at) VALUES (?, ?)', hash, expiresAtMs)
          return true
        } catch {
          return false
        }
      },
      deleteExpired(nowMs) {
        sql.exec('DELETE FROM nonces WHERE expires_at <= ?', nowMs)
      },
      earliestExpiryMs: () =>
        sql.exec<{ t: number | null }>('SELECT MIN(expires_at) AS t FROM nonces').toArray()[0]?.t ?? null,
    },

    idempotency: {
      recall: commandId =>
        sql.exec<{ ack: string }>(
          'SELECT ack FROM idempotency WHERE cmd_id = ?', commandId
        ).toArray()[0]?.ack,
      remember(commandId, ack, expiresAtMs) {
        sql.exec(
          'INSERT OR REPLACE INTO idempotency (cmd_id, ack, expires_at) VALUES (?, ?, ?)',
          commandId, ack, expiresAtMs
        )
      },
      deleteExpired(nowMs) {
        sql.exec('DELETE FROM idempotency WHERE expires_at <= ?', nowMs)
      },
      earliestExpiryMs: () =>
        sql.exec<{ t: number | null }>('SELECT MIN(expires_at) AS t FROM idempotency').toArray()[0]?.t ?? null,
    },

    events: {
      append(events: readonly StreamEvent[], nowMs) {
        // No awaits between reading the cursor and writing it back, so the
        // sequence cannot interleave with another append on this object.
        let seq = Number(meta('stream_seq') ?? '0')
        const appended: StoredEvent[] = []
        for (const event of events) {
          seq += 1
          sql.exec(
            'INSERT INTO events (seq, kind, body, created_at) VALUES (?, ?, ?, ?)',
            seq, event.kind, JSON.stringify(event.body), nowMs
          )
          appended.push({ ...event, seq, createdAtMs: nowMs })
        }
        setMeta('stream_seq', String(seq))
        return appended
      },
      since: seq =>
        sql.exec<{ seq: number; kind: string; body: string; created_at: number }>(
          'SELECT seq, kind, body, created_at FROM events WHERE seq > ? ORDER BY seq ASC', seq
        ).toArray().map(row => ({
          seq: row.seq,
          kind: row.kind,
          body: JSON.parse(row.body) as Record<string, unknown>,
          createdAtMs: row.created_at,
        })),
      oldestSeq: () =>
        sql.exec<{ s: number | null }>('SELECT MIN(seq) AS s FROM events').toArray()[0]?.s ?? null,
      latestSeq: () => Number(meta('stream_seq') ?? '0'),
      /**
       * Runs on every alarm, so it is written to read rows in the hundreds
       * rather than the millions.
       *
       * `seq NOT IN (SELECT seq ... LIMIT ?)` tested each candidate against a
       * `keepNewest`-row list and had no index to find the candidates with, so
       * one prune cost roughly `rows × keepNewest` reads. The floor below is a
       * single non-correlated lookup down the `seq` primary key — the seq of
       * the first row outside the retained window — and `events_created`
       * bounds the rows the delete has to visit at all.
       */
      prune(olderThanMs, keepNewest) {
        sql.exec(
          `DELETE FROM events WHERE created_at <= ?
           AND seq <= COALESCE(
             (SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?), -1)`,
          olderThanMs, keepNewest
        )
      },
    },

    mailbox: {
      put(inviteId, body, nowMs) {
        sql.exec(
          'INSERT OR REPLACE INTO mailbox (invite_id, body, created_at) VALUES (?, ?, ?)',
          inviteId, body, nowMs
        )
      },
      drop(inviteId) {
        sql.exec('DELETE FROM mailbox WHERE invite_id = ?', inviteId)
      },
      count: () =>
        sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM mailbox').toArray()[0].n,
      has: inviteId =>
        sql.exec<{ invite_id: string }>(
          'SELECT invite_id FROM mailbox WHERE invite_id = ?', inviteId
        ).toArray().length > 0,
      oldestId: () =>
        sql.exec<{ invite_id: string }>(
          'SELECT invite_id FROM mailbox ORDER BY created_at ASC, invite_id ASC LIMIT 1'
        ).toArray()[0]?.invite_id,
    },
  }
}
