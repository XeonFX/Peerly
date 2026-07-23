import { DurableObject } from 'cloudflare:workers'
import { LIMITS } from './limits.mjs'

/**
 * `RoomDirectoryShardDO` (HeyHubs only) — signed, expiring, paginated
 * public-room listings. Shard count starts at 1 (LIMITS.shardCount); rooms
 * expire on their own, so raising the shard constant later re-buckets
 * naturally without a migration. See
 * docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 11.
 */
export class RoomDirectoryShardDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          room_id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, dk TEXT NOT NULL,
          revision INTEGER NOT NULL, entry TEXT NOT NULL,
          updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS rooms_exp ON rooms(expires_at);
        CREATE INDEX IF NOT EXISTS rooms_listing ON rooms(updated_at, room_id);
      `)
    })
  }

  async publish({ roomId, ownerUid, dk, revision, entry, expiresAt }) {
    const now = Date.now()
    const existing = this.ctx.storage.sql.exec(
      'SELECT owner_uid, revision FROM rooms WHERE room_id = ?', roomId
    ).toArray()[0]
    if (existing) {
      if (existing.owner_uid !== ownerUid) return { code: 'conflict' }
      if (revision <= existing.revision) return { code: 'conflict' }
    } else {
      const count = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM rooms').toArray()[0].n
      if (count >= LIMITS.directoryMaxRoomsPerShard) return { code: 'cap-exceeded' }
    }
    const entryBytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength
    if (entryBytes > LIMITS.directoryPayloadBytes) return { code: 'too-large' }
    this.ctx.storage.sql.exec(
      `INSERT INTO rooms (room_id, owner_uid, dk, revision, entry, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET dk = excluded.dk, revision = excluded.revision,
         entry = excluded.entry, updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
      roomId, ownerUid, dk, revision, JSON.stringify(entry), now, expiresAt
    )
    await this.ctx.storage.setAlarm(expiresAt)
    return { ok: true }
  }

  async remove({ roomId, ownerUid, revision }) {
    const existing = this.ctx.storage.sql.exec(
      'SELECT owner_uid, revision FROM rooms WHERE room_id = ?', roomId
    ).toArray()[0]
    if (!existing) return { ok: true }
    if (existing.owner_uid !== ownerUid) return { code: 'conflict' }
    if (revision <= existing.revision) return { code: 'conflict' }
    this.ctx.storage.sql.exec('DELETE FROM rooms WHERE room_id = ?', roomId)
    return { ok: true }
  }

  async list({ cursor, limit = LIMITS.directoryPageEntries }) {
    const now = Date.now()
    const boundedLimit = Math.min(limit, LIMITS.directoryPageEntries)
    let cursorUpdatedAt = Infinity
    let cursorRoomId = ''
    if (cursor) {
      try {
        const decoded = JSON.parse(atob(cursor))
        cursorUpdatedAt = decoded.u
        cursorRoomId = decoded.r
      } catch {
        // malformed cursor: start from the beginning rather than erroring
      }
    }
    const rows = this.ctx.storage.sql.exec(
      `SELECT room_id, entry, updated_at FROM rooms
       WHERE expires_at > ? AND (updated_at < ? OR (updated_at = ? AND room_id > ?))
       ORDER BY updated_at DESC, room_id ASC LIMIT ?`,
      now, cursorUpdatedAt, cursorUpdatedAt, cursorRoomId, boundedLimit
    ).toArray()
    const nextCursor = rows.length === boundedLimit
      ? btoa(JSON.stringify({ u: rows[rows.length - 1].updated_at, r: rows[rows.length - 1].room_id }))
      : null
    return {
      entries: rows.map(row => ({ roomId: row.room_id, entry: JSON.parse(row.entry) })),
      cursor: nextCursor,
    }
  }

  async alarm() {
    const now = Date.now()
    this.ctx.storage.sql.exec('DELETE FROM rooms WHERE expires_at <= ?', now)
    const nextRow = this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM rooms').toArray()[0]
    if (nextRow?.t) await this.ctx.storage.setAlarm(nextRow.t)
  }
}
