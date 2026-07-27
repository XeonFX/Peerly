/**
 * `ScopeStore` over a Durable Object's SQLite. The in-memory equivalent lives
 * in the runtime's own test; both satisfy the same narrow interface, which is
 * what lets every routing and lifetime rule be exercised without a runtime.
 */
import type { Authorization, ScopeStore } from './signalScopeRuntime.js'
import type { SqlExecutor } from './sqlGatewayStorage.js'

export const SCOPE_SCHEMA = `
CREATE TABLE IF NOT EXISTS authorizations (
  uid TEXT NOT NULL, dk TEXT NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY (uid, dk));
CREATE INDEX IF NOT EXISTS auth_exp ON authorizations(expires_at);
`

type Row = { uid: string; dk: string; expires_at: number }

const toAuthorization = (row: Row): Authorization => ({
  uid: row.uid,
  deviceKeyId: row.dk,
  expiresAtMs: row.expires_at,
})

export function createSqlScopeStore(sql: SqlExecutor): ScopeStore {
  return {
    authorize(record) {
      sql.exec(
        'INSERT OR REPLACE INTO authorizations (uid, dk, expires_at) VALUES (?, ?, ?)',
        record.uid, record.deviceKeyId, record.expiresAtMs
      )
    },
    find(uid, deviceKeyId) {
      const row = sql.exec<Row>(
        'SELECT uid, dk, expires_at FROM authorizations WHERE uid = ? AND dk = ?', uid, deviceKeyId
      ).toArray()[0]
      return row ? toAuthorization(row) : undefined
    },
    remove(uid, deviceKeyId) {
      sql.exec('DELETE FROM authorizations WHERE uid = ? AND dk = ?', uid, deviceKeyId)
    },
    count: () => sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM authorizations').toArray()[0].n,
    deleteExpired(nowMs) {
      sql.exec('DELETE FROM authorizations WHERE expires_at <= ?', nowMs)
    },
    earliestExpiryMs: () =>
      sql.exec<{ t: number | null }>('SELECT MIN(expires_at) AS t FROM authorizations').toArray()[0]?.t ?? null,
  }
}
