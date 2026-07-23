import { DurableObject } from 'cloudflare:workers'
import { LIMITS } from './limits.mjs'

/**
 * One `InterestQueueDO` per normalized interest (HeyHubs only). Runs
 * "any shared interest" matching via a two-phase gateway reservation so two
 * queues can never commit the same user twice. See
 * docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 9.
 */
export class InterestQueueDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS seeks (
          uid TEXT PRIMARY KEY, seek_id TEXT NOT NULL, dk TEXT NOT NULL,
          exclusions TEXT NOT NULL DEFAULT '[]',
          enqueued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS seeks_exp ON seeks(expires_at);
        CREATE TABLE IF NOT EXISTS cooldowns (
          pair TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      `)
    })
  }

  async enqueue({ uid, seekId, dk, exclusions = [], expiresAt }) {
    const now = Date.now()
    this.ctx.storage.sql.exec(
      `INSERT INTO seeks (uid, seek_id, dk, exclusions, enqueued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET seek_id = excluded.seek_id, dk = excluded.dk,
         exclusions = excluded.exclusions, expires_at = excluded.expires_at`,
      uid, seekId, dk, JSON.stringify(exclusions), now, expiresAt
    )
    await this.scheduleNextAlarm()
    await this.runMatching()
    return { ok: true }
  }

  async dequeue({ uid, seekId }) {
    this.ctx.storage.sql.exec('DELETE FROM seeks WHERE uid = ? AND seek_id = ?', uid, seekId)
    return { ok: true }
  }

  pairKey(a, b) {
    return [a, b].sort().join('\n')
  }

  appName() {
    return (this.ctx.id.name ?? '').split(':')[0] || 'heyhubs'
  }

  async runMatching() {
    if (!this.env.USER_GATEWAYS) return
    const now = Date.now()
    // Bounded scan: at most the 20 oldest live seeks are considered per pass.
    for (let guard = 0; guard < 20; guard += 1) {
      const seeks = this.ctx.storage.sql.exec(
        'SELECT uid, seek_id, dk, exclusions FROM seeks WHERE expires_at > ? ORDER BY enqueued_at ASC LIMIT 20', now
      ).toArray()
      if (seeks.length < 2) return

      let pair = null
      outer: for (let i = 0; i < seeks.length; i += 1) {
        for (let j = i + 1; j < seeks.length; j += 1) {
          const a = seeks[i]
          const b = seeks[j]
          const aExcludes = JSON.parse(a.exclusions ?? '[]')
          const bExcludes = JSON.parse(b.exclusions ?? '[]')
          if (aExcludes.includes(b.uid) || bExcludes.includes(a.uid)) continue
          const cooldown = this.ctx.storage.sql.exec(
            'SELECT 1 FROM cooldowns WHERE pair = ? AND expires_at > ?', this.pairKey(a.uid, b.uid), now
          ).toArray()[0]
          if (cooldown) continue
          pair = [a, b]
          break outer
        }
      }
      if (!pair) return

      const matched = await this.tryMatch(pair[0], pair[1])
      if (!matched) continue // one side was busy/stale; loop re-reads fresh state
      return
    }
  }

  async tryMatch(a, b) {
    const app = this.appName()
    const [first, second] = a.uid < b.uid ? [a, b] : [b, a]
    const reservationId = crypto.randomUUID()
    const expiresAt = Date.now() + LIMITS.reservationMs

    const firstGateway = this.env.USER_GATEWAYS.getByName(`${app}:${first.uid}`)
    const firstResult = await firstGateway.reserveForMatch({
      reservationId, queueKey: this.ctx.id.name, seekId: first.seek_id, expiresAt,
    })
    if (firstResult.busy) {
      this.ctx.storage.sql.exec('DELETE FROM seeks WHERE uid = ?', first.uid)
      return false
    }

    const secondGateway = this.env.USER_GATEWAYS.getByName(`${app}:${second.uid}`)
    const secondResult = await secondGateway.reserveForMatch({
      reservationId, queueKey: this.ctx.id.name, seekId: second.seek_id, expiresAt,
    })
    if (secondResult.busy) {
      await firstGateway.releaseMatch({ reservationId }).catch(() => {})
      this.ctx.storage.sql.exec('DELETE FROM seeks WHERE uid = ?', second.uid)
      return false
    }

    const matchId = crypto.randomUUID()
    const capability = crypto.getRandomValues(new Uint8Array(32))
    const capabilityStr = btoa(String.fromCharCode(...capability))
    const { deriveScopeRouteId } = await import('./crypto.mjs')
    const routeId = await deriveScopeRouteId(this.env.OPAQUE_USER_ID_SECRET, app, 'chat', capabilityStr)

    if (this.env.SIGNAL_SCOPES) {
      const scope = this.env.SIGNAL_SCOPES.getByName(`${app}:${routeId}`)
      await Promise.allSettled([
        scope.authorize({ uid: first.uid, dk: first.dk, expiresAt: Date.now() + LIMITS.scopeAuthorizationTtlMs }),
        scope.authorize({ uid: second.uid, dk: second.dk, expiresAt: Date.now() + LIMITS.scopeAuthorizationTtlMs }),
      ])
    }

    await Promise.allSettled([
      firstGateway.commitMatch({
        reservationId, matchId, routeId, peerUid: second.uid, initiator: true,
      }),
      secondGateway.commitMatch({
        reservationId, matchId, routeId, peerUid: first.uid, initiator: false,
      }),
    ])

    this.ctx.storage.sql.exec('DELETE FROM seeks WHERE uid IN (?, ?)', first.uid, second.uid)
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO cooldowns (pair, expires_at) VALUES (?, ?)',
      this.pairKey(first.uid, second.uid), Date.now() + LIMITS.matchCooldownMs
    )
    if (this.env.PRESENCE_STATS) {
      const interest = (this.ctx.id.name ?? '').split(':').slice(1).join(':')
      const count = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM seeks').toArray()[0].n
      await this.env.PRESENCE_STATS.getByName(`${app}:0`).publishCount({ tag: interest, count }).catch(() => {})
    }
    return true
  }

  async scheduleNextAlarm() {
    const next = this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM seeks').toArray()[0]?.t
    if (next) await this.ctx.storage.setAlarm(next)
  }

  async alarm() {
    const now = Date.now()
    this.ctx.storage.sql.exec('DELETE FROM seeks WHERE expires_at <= ?', now)
    this.ctx.storage.sql.exec('DELETE FROM cooldowns WHERE expires_at <= ?', now)
    await this.runMatching()
    await this.scheduleNextAlarm()
  }
}
