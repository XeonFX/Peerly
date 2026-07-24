import { DurableObject } from 'cloudflare:workers'
import { LIMITS } from './limits.mjs'
import { createTokenBucket } from './rateLimit.mjs'
import { CLOSE, encodeFrame, FrameError, parseFrame, SIGNAL_TYPE } from './protocol.mjs'

const SIGNAL_TYPES = new Set([SIGNAL_TYPE])

/**
 * One `SignalScopeDO` per active WebRTC signaling scope (one chat/DM/room/
 * workspace). Forwards opaque offer/answer/ICE envelopes between
 * authenticated participants; never parses or persists their content. See
 * docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 7.
 */
export class SignalScopeDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.buckets = new Map()
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS authorizations (
          uid TEXT NOT NULL, dk TEXT NOT NULL, expires_at INTEGER NOT NULL,
          PRIMARY KEY (uid, dk));
        CREATE INDEX IF NOT EXISTS auth_exp ON authorizations(expires_at);
      `)
    })
  }

  async authorize({ uid, dk, expiresAt }) {
    const count = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM authorizations').toArray()[0].n
    const existing = this.ctx.storage.sql.exec(
      'SELECT 1 FROM authorizations WHERE uid = ? AND dk = ?', uid, dk
    ).toArray()[0]
    if (!existing && count >= LIMITS.participantsPerScope * 2) return { code: 'cap-exceeded' }
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO authorizations (uid, dk, expires_at) VALUES (?, ?, ?)', uid, dk, expiresAt
    )
    // Never push out an earlier pending alarm: a later-expiring authorize
    // must not delay pruning of rows that expire sooner.
    const pending = await this.ctx.storage.getAlarm()
    if (pending === null || expiresAt < pending) await this.ctx.storage.setAlarm(expiresAt)
    return { ok: true }
  }

  /**
   * Drop one participant's authorization on an explicit `scope.leave`, rather
   * than waiting out its lease. Any socket that device still has open here is
   * closed too — an authorization is what makes the socket legitimate, so
   * leaving it open after revoking would defeat the point.
   */
  async release({ uid, dk }) {
    this.ctx.storage.sql.exec('DELETE FROM authorizations WHERE uid = ? AND dk = ?', uid, dk)
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment()
      if (attachment?.uid === uid && attachment?.dk === dk) ws.close(CLOSE.AUTH_REQUIRED, 'scope left')
    }
    return { ok: true }
  }

  async fetch(request) {
    const uid = request.headers.get('x-realtime-uid')
    const dk = request.headers.get('x-realtime-dk')
    if (!uid || !dk) return new Response('Unauthorized', { status: 401 })
    const row = this.ctx.storage.sql.exec(
      'SELECT expires_at FROM authorizations WHERE uid = ? AND dk = ?', uid, dk
    ).toArray()[0]
    if (!row || row.expires_at <= Date.now()) return new Response('Forbidden', { status: 403 })

    if (this.ctx.getWebSockets().length >= LIMITS.participantsPerScope) {
      return new Response('Scope is full', { status: 409 })
    }

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    const cid = crypto.randomUUID()
    server.serializeAttachment({ cid, uid, dk })
    this.announce(server, 'peer.join', { from: cid })
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, message) {
    let frame
    try {
      frame = parseFrame(message, { maxBytes: LIMITS.signalFrameBytes, allowedTypes: SIGNAL_TYPES })
    } catch (error) {
      if (error instanceof FrameError && error.close) return ws.close(error.close, error.message)
      return
    }
    const attachment = ws.deserializeAttachment()
    if (!this.takeToken(attachment.cid)) return ws.close(CLOSE.RATE_LIMIT_ABUSE, 'signal rate limit')

    // A participant claiming the topics it listens on. Only the envelope's
    // `topic` strings are ever read — the `message` beside them stays opaque,
    // exactly as before.
    if (Array.isArray(frame.payload?.subscribe)) {
      const topics = frame.payload.subscribe
        .filter(topic => typeof topic === 'string' && topic.length > 0 && topic.length <= 256)
        .slice(0, LIMITS.topicsPerParticipant)
      ws.serializeAttachment({ ...attachment, topics })
      return
    }

    const outgoing = encodeFrame(SIGNAL_TYPE, { payload: { ...frame.payload, from: attachment.cid } })
    if (frame.payload?.to) {
      for (const other of this.ctx.getWebSockets()) {
        if (other.deserializeAttachment()?.cid === frame.payload.to) other.send(outgoing)
      }
      return
    }

    // Route by topic when the participants have claimed one. Trystero
    // addresses per-peer topics for offers/answers/ICE and only its periodic
    // announce goes to the room-wide topic, so broadcasting everything made
    // signaling O(N^2) in a room and handed every participant every other
    // pair's envelopes. An unclaimed topic still broadcasts, which is what
    // keeps the room-wide announce working.
    const topic = frame.payload?.topic
    const listeners = typeof topic === 'string'
      ? this.ctx.getWebSockets().filter(other => other !== ws && other.deserializeAttachment()?.topics?.includes(topic))
      : []
    if (listeners.length > 0) {
      for (const other of listeners) other.send(outgoing)
      return
    }
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(outgoing)
    }
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment()
    this.buckets.delete(attachment?.cid)
    this.announce(ws, 'peer.leave', { from: attachment?.cid })
    if (this.ctx.getWebSockets().length === 0) {
      const remaining = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM authorizations').toArray()[0].n
      if (remaining === 0) await this.ctx.storage.deleteAll()
    }
  }

  async webSocketError(ws) {
    this.buckets.delete(ws.deserializeAttachment()?.cid)
  }

  announce(self, type, payload) {
    const message = encodeFrame(type, { payload })
    for (const other of this.ctx.getWebSockets()) {
      if (other !== self) other.send(message)
    }
  }

  takeToken(cid) {
    let bucket = this.buckets.get(cid)
    if (!bucket) {
      bucket = createTokenBucket({ burst: LIMITS.signalsBurst, sustainedPerSecond: LIMITS.signalsSustained })
      this.buckets.set(cid, bucket)
    }
    return bucket.take()
  }

  async alarm() {
    const now = Date.now()
    this.ctx.storage.sql.exec('DELETE FROM authorizations WHERE expires_at <= ?', now)
    const remainingRow = this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM authorizations').toArray()[0]
    if (remainingRow?.t) {
      await this.ctx.storage.setAlarm(remainingRow.t)
    } else if (this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll()
    }
  }
}
