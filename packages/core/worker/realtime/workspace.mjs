import { DurableObject } from 'cloudflare:workers'

/**
 * One `WorkspaceDO` per Peerly workspace scope. Coordinates membership and
 * presence metadata only — private workspace content (messages, files,
 * reactions, history) stays P2P and locally persisted. See
 * docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 8.
 */
export class WorkspaceDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS members (
          uid TEXT PRIMARY KEY, dk TEXT NOT NULL, capability_version INTEGER NOT NULL,
          joined_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS members_exp ON members(expires_at);
        CREATE TABLE IF NOT EXISTS presence (
          uid TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
      `)
    })
  }

  async join({ uid, dk, capabilityVersion, ttlMs = 30 * 24 * 60 * 60_000 }) {
    const now = Date.now()
    this.ctx.storage.sql.exec(
      `INSERT INTO members (uid, dk, capability_version, joined_at, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET dk = excluded.dk, capability_version = excluded.capability_version, expires_at = excluded.expires_at`,
      uid, dk, capabilityVersion, now, now + ttlMs
    )
    await this.broadcastPresence(uid, 'joined')
    await this.ctx.storage.setAlarm(now + ttlMs)
    return { ok: true }
  }

  async leave({ uid }) {
    this.ctx.storage.sql.exec('DELETE FROM members WHERE uid = ?', uid)
    this.ctx.storage.sql.exec('DELETE FROM presence WHERE uid = ?', uid)
    await this.broadcastPresence(uid, 'left')
    return { ok: true }
  }

  async presenceUpdate({ uid, state }) {
    this.ctx.storage.sql.exec(
      `INSERT INTO presence (uid, state, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      uid, state, Date.now()
    )
    await this.broadcastPresence(uid, state)
    return { ok: true }
  }

  async revokeMember({ uid }) {
    this.ctx.storage.sql.exec('DELETE FROM members WHERE uid = ?', uid)
    await this.broadcastPresence(uid, 'revoked')
    return { ok: true }
  }

  async broadcastPresence(uid, state) {
    if (!this.env.USER_GATEWAYS) return
    const appPart = (this.ctx.id.name ?? '').split(':')[0] || 'peerly'
    const members = this.ctx.storage.sql.exec('SELECT uid FROM members WHERE uid != ?', uid).toArray()
    await Promise.allSettled(members.map(member => this.env.USER_GATEWAYS.getByName(`${appPart}:${member.uid}`)
      .deliver({ events: [{ kind: 'workspace.presence', body: { uid, state } }] })))
  }

  async alarm() {
    const now = Date.now()
    this.ctx.storage.sql.exec('DELETE FROM members WHERE expires_at <= ?', now)
    const nextRow = this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM members').toArray()[0]
    if (nextRow?.t) await this.ctx.storage.setAlarm(nextRow.t)
  }
}
