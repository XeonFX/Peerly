import { DurableObject } from 'cloudflare:workers'
import { LIMITS } from './limits.mjs'

/**
 * `PresenceStatsShardDO` (HeyHubs only) — best-effort online/interest
 * statistics outside the matching correctness path. Shard count starts at 1
 * (see docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 10 for the request-
 * amplification math behind that choice); raise `LIMITS.shardCount` only
 * once a single object approaches its throughput ceiling.
 */
export class PresenceStatsShardDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS presence (uid TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS presence_exp ON presence(expires_at);
        CREATE TABLE IF NOT EXISTS counters (tag TEXT PRIMARY KEY, count INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      `)
    })
  }

  async presenceUpsert({ uid, expiresAt }) {
    this.ctx.storage.sql.exec(
      `INSERT INTO presence (uid, expires_at) VALUES (?, ?)
       ON CONFLICT(uid) DO UPDATE SET expires_at = excluded.expires_at`,
      uid, expiresAt
    )
    const nextRow = this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM presence').toArray()[0]
    if (nextRow?.t) await this.ctx.storage.setAlarm(nextRow.t)
    return { ok: true }
  }

  async publishCount({ tag, count }) {
    this.ctx.storage.sql.exec(
      `INSERT INTO counters (tag, count, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(tag) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at`,
      tag, count, Date.now()
    )
    return { ok: true }
  }

  async snapshot() {
    const now = Date.now()
    const online = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM presence WHERE expires_at > ?', now).toArray()[0].n
    const interests = this.ctx.storage.sql.exec(
      'SELECT tag, count FROM counters ORDER BY count DESC LIMIT 50'
    ).toArray()
    return { online, interests }
  }

  async alarm() {
    const now = Date.now()
    this.ctx.storage.sql.exec('DELETE FROM presence WHERE expires_at <= ?', now)
    const nextRow = this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM presence').toArray()[0]
    if (nextRow?.t) await this.ctx.storage.setAlarm(nextRow.t)
  }
}

/** `GET /api/stats/snapshot` — cached per-colo, demand-driven (never polled by a hidden tab). */
export async function handleStatsSnapshot(request, env, config) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } })
  if (!env.PRESENCE_STATS) return new Response('Not configured', { status: 503 })
  const cache = caches.default
  const cacheKey = new Request(new URL('/api/stats/snapshot', request.url).toString(), { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) return cached
  const snapshot = await env.PRESENCE_STATS.getByName(`${config.app}:0`).snapshot()
  const response = Response.json(snapshot, {
    headers: { 'cache-control': `public, max-age=${LIMITS.statsCacheSeconds}`, 'x-content-type-options': 'nosniff' },
  })
  await cache.put(cacheKey, response.clone())
  return response
}
