import { DurableObject } from 'cloudflare:workers'
import { LIMITS } from './limits.mjs'
import { createTokenBucket } from './rateLimit.mjs'
import {
  CLOSE, encodeAck, encodeDelta, encodeError, encodeSnapshot, FrameError, parseFrame,
} from './protocol.mjs'

const PING = 'ping'
const PONG = 'pong'

function nowMs() {
  return Date.now()
}

/**
 * One `UserGatewayDO` per opaque account (`app:opaqueUserId`). Owns every
 * active control WebSocket for that account, the authoritative seek/match
 * reservation, device/session revocation epochs, and the event stream every
 * control socket resumes from. See docs/DURABLE_OBJECTS_IMPLEMENTATION.md
 * section 6 for the full design.
 */
export class UserGatewayDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.buckets = new Map() // cid -> { commands: bucket, ... } — in-memory only, see rateLimit.mjs
    // getByName(`${app}:${uid}`) makes the full name recoverable from the id
    // it produced; that is the only reliable source of "which account is
    // this" inside the object (there is no reverse lookup from HMAC output).
    const [appPart, ...uidParts] = (ctx.id.name ?? '').split(':')
    this.appPart = appPart || 'app'
    this.uidPart = uidParts.join(':')
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
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
        CREATE TABLE IF NOT EXISTS mailbox (
          invite_id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS seek (
          one INTEGER PRIMARY KEY CHECK (one = 1), seek_id TEXT, state TEXT,
          reservation_id TEXT, queue_key TEXT, interests TEXT, expires_at INTEGER);
      `)
    })
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  // ---- HTTP entry: WebSocket upgrade only; everything else is RPC. ----

  async fetch(request) {
    const uid = request.headers.get('x-realtime-uid')
    const dk = request.headers.get('x-realtime-dk')
    const sid = request.headers.get('x-realtime-sid')
    if (!uid || !dk || !sid) return new Response('Unauthorized', { status: 401 })

    const now = nowMs()
    const row = this.ctx.storage.sql.exec(
      'SELECT dk, epoch, expires_at FROM sessions WHERE sid = ?', sid
    ).toArray()[0]
    if (!row || row.dk !== dk || row.expires_at <= now) return new Response('Unauthorized', { status: 401 })
    const epochRow = this.ctx.storage.sql.exec('SELECT epoch FROM device_epochs WHERE dk = ?', dk).toArray()[0]
    if (epochRow && epochRow.epoch !== row.epoch) return new Response('Unauthorized', { status: 401 })

    const openSockets = this.ctx.getWebSockets()
    if (openSockets.length >= LIMITS.controlSocketsPerAccount) {
      openSockets[0].close(CLOSE.SLOW_CONSUMER, 'connection limit')
    }

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    const cid = crypto.randomUUID()
    server.serializeAttachment({ cid, dk, sid, v: 0, ackSeq: 0 })
    return new Response(null, { status: 101, webSocket: client })
  }

  // ---- WebSocket handlers ----

  async webSocketMessage(ws, message) {
    let attachment = ws.deserializeAttachment() ?? {}
    let frame
    try {
      frame = parseFrame(message, { maxBytes: LIMITS.controlFrameBytes })
    } catch (error) {
      if (error instanceof FrameError && error.close) return ws.close(error.close, error.message)
      return ws.send(encodeError('invalid-frame', { retryable: false }))
    }

    if (!attachment.v) {
      if (frame.type !== 'hello') return ws.close(CLOSE.MALFORMED_FRAME, 'expected hello')
      attachment = { ...attachment, v: frame.payload.version }
      ws.serializeAttachment(attachment)
      ws.send(encodeAck(frame.id))
      if (typeof frame.payload.resumeSeq === 'number') await this.sendResume(ws, frame.payload.resumeSeq)
      return
    }

    if (!this.takeToken(attachment.cid, 'commands')) {
      return ws.send(encodeError('rate-limited', { forId: frame.id, retryable: true, retryAfterMs: 1000 }))
    }

    if (frame.type === 'resume') return this.sendResume(ws, frame.payload.fromSeq)

    const existing = this.ctx.storage.sql.exec(
      'SELECT ack FROM idempotency WHERE cmd_id = ?', frame.id
    ).toArray()[0]
    if (existing) return ws.send(existing.ack)

    const ack = await this.dispatch(frame, attachment)
    if (ack) {
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO idempotency (cmd_id, ack, expires_at) VALUES (?, ?, ?)',
        frame.id, ack, nowMs() + LIMITS.idempotencyTtlMs
      )
      ws.send(ack)
    }
  }

  async webSocketClose(ws) {
    this.buckets.delete(ws.deserializeAttachment()?.cid)
  }

  async webSocketError(ws) {
    this.buckets.delete(ws.deserializeAttachment()?.cid)
  }

  takeToken(cid, kind) {
    const key = `${cid}:${kind}`
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = createTokenBucket({ burst: LIMITS.commandsBurst, sustainedPerSecond: LIMITS.commandsSustained })
      this.buckets.set(key, bucket)
    }
    return bucket.take()
  }

  async dispatch(frame, attachment) {
    const { type, payload, id } = frame
    switch (type) {
      case 'seek.start':
        return this.handleSeekStart(id, payload, attachment)
      case 'seek.cancel':
        return this.handleSeekCancel(id, payload)
      case 'scope.request':
        return this.handleScopeRequest(id, payload, attachment)
      case 'scope.leave':
        return encodeAck(id)
      case 'invite.send':
        return this.handleInviteSend(id, payload)
      case 'invite.ack':
        return encodeAck(id)
      case 'ring.send':
        return this.handleRingSend(id, payload)
      case 'directory.publish':
        return this.handleDirectoryPublish(id, payload, attachment)
      case 'directory.delete':
        return this.handleDirectoryDelete(id, payload)
      case 'directory.list':
        return this.handleDirectoryList(id, payload)
      default:
        return encodeError('not-found', { forId: id })
    }
  }

  async handleSeekStart(id, payload, attachment) {
    if (!this.env.INTEREST_QUEUES) return encodeError('not-found', { forId: id })
    const interests = [...new Set(payload.interests.map(value => value.trim().toLowerCase().normalize('NFKC')))]
      .filter(Boolean).slice(0, LIMITS.interestsPerSeek)
    const now = nowMs()
    const expiresAt = now + LIMITS.seekLeaseMs
    this.ctx.storage.sql.exec(
      `INSERT INTO seek (one, seek_id, state, reservation_id, queue_key, interests, expires_at)
       VALUES (1, ?, 'seeking', NULL, NULL, ?, ?)
       ON CONFLICT(one) DO UPDATE SET seek_id = excluded.seek_id, state = 'seeking',
         reservation_id = NULL, interests = excluded.interests, expires_at = excluded.expires_at`,
      payload.seekId, JSON.stringify(interests), expiresAt
    )
    await this.scheduleNextAlarm()
    await Promise.allSettled(interests.map(interest => this.env.INTEREST_QUEUES.getByName(this.queueKey(interest))
      .enqueue({ uid: this.uidPart, seekId: payload.seekId, dk: attachment.dk, exclusions: payload.exclusions ?? [], expiresAt })))
    return encodeAck(id)
  }

  async handleSeekCancel(id, payload) {
    const row = this.ctx.storage.sql.exec('SELECT seek_id, interests FROM seek WHERE one = 1').toArray()[0]
    this.ctx.storage.sql.exec('DELETE FROM seek WHERE one = 1')
    if (this.env.INTEREST_QUEUES && row && row.seek_id === payload.seekId) {
      const interests = JSON.parse(row.interests ?? '[]')
      await Promise.allSettled(interests.map(interest => this.env.INTEREST_QUEUES.getByName(this.queueKey(interest))
        .dequeue({ uid: this.uidPart, seekId: payload.seekId })))
    }
    return encodeAck(id)
  }

  async handleScopeRequest(id, payload, attachment) {
    if (!this.env.SIGNAL_SCOPES) return encodeError('not-found', { forId: id })
    const { deriveScopeRouteId } = await import('./crypto.mjs')
    const routeId = await deriveScopeRouteId(this.env.OPAQUE_USER_ID_SECRET, this.appPart, payload.kind, payload.capability)
    const expiresAt = nowMs() + LIMITS.scopeAuthorizationTtlMs
    await this.env.SIGNAL_SCOPES.getByName(`${this.appPart}:${routeId}`)
      .authorize({ uid: this.uidPart, dk: attachment.dk, expiresAt })
    return encodeAck(id, { routeId, expiresAt })
  }

  async handleInviteSend(id, payload) {
    const target = this.env.USER_GATEWAYS.getByName(`${this.appPart}:${payload.to}`)
    const inviteId = crypto.randomUUID()
    await target.deliver({
      events: [{ kind: 'invite', body: { inviteId, from: this.uidPart, kind: payload.kind, body: payload.body } }],
      mailbox: { inviteId, body: JSON.stringify({ from: this.uidPart, kind: payload.kind, body: payload.body }) },
    })
    return encodeAck(id, { inviteId })
  }

  async handleRingSend(id, payload) {
    const target = this.env.USER_GATEWAYS.getByName(`${this.appPart}:${payload.to}`)
    await target.deliver({ events: [{ kind: 'ring', body: { from: this.uidPart, roomRoute: payload.roomRoute } }] })
    return encodeAck(id)
  }

  async handleDirectoryPublish(id, payload, attachment) {
    if (!this.env.ROOM_DIRECTORY) return encodeError('not-found', { forId: id })
    const shard = this.env.ROOM_DIRECTORY.getByName(this.directoryShardKey(payload.roomId))
    const result = await shard.publish({
      roomId: payload.roomId, ownerUid: this.uidPart, dk: attachment.dk,
      revision: payload.revision, entry: payload.entry, expiresAt: nowMs() + LIMITS.seekLeaseMs,
    })
    if (result.code) return encodeError('conflict', { forId: id })
    return encodeAck(id)
  }

  async handleDirectoryDelete(id, payload) {
    if (!this.env.ROOM_DIRECTORY) return encodeError('not-found', { forId: id })
    const shard = this.env.ROOM_DIRECTORY.getByName(this.directoryShardKey(payload.roomId))
    await shard.remove({ roomId: payload.roomId, ownerUid: this.uidPart, revision: payload.revision })
    return encodeAck(id)
  }

  async handleDirectoryList(id, payload) {
    if (!this.env.ROOM_DIRECTORY) return encodeError('not-found', { forId: id })
    const shard = this.env.ROOM_DIRECTORY.getByName(`${this.appPart}:0`)
    const page = await shard.list({ cursor: payload?.cursor, limit: LIMITS.directoryPageEntries })
    return encodeAck(id, page)
  }

  // ---- helpers derived from this DO's own name/env, not persisted ----

  queueKey(interest) {
    return `${this.appPart}:${interest}`
  }

  directoryShardKey(_roomId) {
    return `${this.appPart}:0` // shardCount starts at 1; see LIMITS.shardCount
  }

  // ---- RPC methods (invoked by Worker routes and other DOs) ----

  async consumeNonce(hashHex, expiresAt) {
    try {
      this.ctx.storage.sql.exec('INSERT INTO nonces (hash, expires_at) VALUES (?, ?)', hashHex, expiresAt)
      await this.scheduleNextAlarm()
      return true
    } catch {
      return false
    }
  }

  async registerSession({ dk, now, ttlMs }) {
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', now)
    const live = this.ctx.storage.sql.exec('SELECT DISTINCT dk FROM sessions').toArray()
    const distinctDevices = new Set(live.map(row => row.dk))
    if (!distinctDevices.has(dk) && distinctDevices.size >= LIMITS.controlSocketsPerAccount) {
      return { code: 'cap-exceeded' }
    }
    const epochRow = this.ctx.storage.sql.exec('SELECT epoch FROM device_epochs WHERE dk = ?', dk).toArray()[0]
    const epoch = epochRow?.epoch ?? 0
    if (!epochRow) this.ctx.storage.sql.exec('INSERT INTO device_epochs (dk, epoch) VALUES (?, 0)', dk)
    const sid = crypto.randomUUID()
    this.ctx.storage.sql.exec(
      'INSERT INTO sessions (sid, dk, epoch, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      sid, dk, epoch, now, now + ttlMs
    )
    await this.scheduleNextAlarm()
    return { sid, epoch }
  }

  async validateSession({ sid, dk, epoch }) {
    const row = this.ctx.storage.sql.exec(
      'SELECT dk, epoch, expires_at FROM sessions WHERE sid = ?', sid
    ).toArray()[0]
    if (!row || row.dk !== dk || row.epoch !== epoch || row.expires_at <= nowMs()) return { ok: false }
    return { ok: true }
  }

  async revokeDevice(dk) {
    const epochRow = this.ctx.storage.sql.exec('SELECT epoch FROM device_epochs WHERE dk = ?', dk).toArray()[0]
    const nextEpoch = (epochRow?.epoch ?? 0) + 1
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO device_epochs (dk, epoch) VALUES (?, ?)', dk, nextEpoch)
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE dk = ?', dk)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.deserializeAttachment()?.dk === dk) ws.close(CLOSE.AUTH_REQUIRED, 'device revoked')
    }
    return { ok: true }
  }

  async deliver({ events = [], mailbox }) {
    if (events.length) await this.appendEvents(events)
    if (mailbox) {
      const count = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM mailbox').toArray()[0].n
      if (count >= LIMITS.mailboxEntries) {
        const oldest = this.ctx.storage.sql.exec(
          'SELECT invite_id FROM mailbox ORDER BY created_at ASC LIMIT 1'
        ).toArray()[0]
        if (oldest) this.ctx.storage.sql.exec('DELETE FROM mailbox WHERE invite_id = ?', oldest.invite_id)
      }
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO mailbox (invite_id, body, created_at) VALUES (?, ?, ?)',
        mailbox.invite_id ?? mailbox.inviteId, mailbox.body, nowMs()
      )
    }
    return { ok: true }
  }

  async reserveForMatch({ reservationId, queueKey, seekId, expiresAt }) {
    const row = this.ctx.storage.sql.exec('SELECT seek_id, state FROM seek WHERE one = 1').toArray()[0]
    if (!row || row.seek_id !== seekId || row.state !== 'seeking') return { busy: true }
    this.ctx.storage.sql.exec(
      "UPDATE seek SET state = 'reserved', reservation_id = ?, queue_key = ?, expires_at = ? WHERE one = 1",
      reservationId, queueKey, expiresAt
    )
    await this.scheduleNextAlarm()
    return { ok: true }
  }

  async commitMatch({ reservationId, matchId, routeId, peerUid }) {
    const row = this.ctx.storage.sql.exec('SELECT reservation_id FROM seek WHERE one = 1').toArray()[0]
    if (!row || row.reservation_id !== reservationId) return { ok: true } // already committed or released; idempotent
    this.ctx.storage.sql.exec('DELETE FROM seek WHERE one = 1')
    await this.appendEvents([{ kind: 'match.commit', body: { matchId, routeId, peer: { opaqueUserId: peerUid } } }])
    return { ok: true }
  }

  async releaseMatch({ reservationId }) {
    const row = this.ctx.storage.sql.exec('SELECT reservation_id, seek_id, state FROM seek WHERE one = 1').toArray()[0]
    if (!row || row.reservation_id !== reservationId) return { ok: true }
    if (row.state === 'reserved') {
      this.ctx.storage.sql.exec("UPDATE seek SET state = 'seeking', reservation_id = NULL WHERE one = 1")
    }
    return { ok: true }
  }

  // ---- event stream / resume ----

  async appendEvents(events) {
    const metaRow = this.ctx.storage.sql.exec("SELECT value FROM meta WHERE key = 'stream_seq'").toArray()[0]
    let seq = metaRow ? Number(metaRow.value) : 0
    const now = nowMs()
    const encoded = []
    for (const event of events) {
      seq += 1
      this.ctx.storage.sql.exec(
        'INSERT INTO events (seq, kind, body, created_at) VALUES (?, ?, ?, ?)',
        seq, event.kind, JSON.stringify(event.body), now
      )
      encoded.push({ kind: event.kind, body: event.body, seq })
    }
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('stream_seq', ?)", String(seq))
    const frame = encodeDelta(encoded, seq)
    for (const ws of this.ctx.getWebSockets()) ws.send(frame)
    return seq
  }

  async sendResume(ws, fromSeq) {
    const oldest = this.ctx.storage.sql.exec('SELECT MIN(seq) AS s FROM events').toArray()[0]?.s
    if (oldest === null || oldest === undefined || fromSeq >= oldest - 1) {
      const rows = this.ctx.storage.sql.exec(
        'SELECT seq, kind, body FROM events WHERE seq > ? ORDER BY seq ASC', fromSeq
      ).toArray()
      if (rows.length) {
        const seq = rows[rows.length - 1].seq
        ws.send(encodeDelta(rows.map(row => ({ kind: row.kind, body: JSON.parse(row.body), seq: row.seq })), seq))
      }
      return
    }
    const metaRow = this.ctx.storage.sql.exec("SELECT value FROM meta WHERE key = 'stream_seq'").toArray()[0]
    const seq = metaRow ? Number(metaRow.value) : 0
    const seekRow = this.ctx.storage.sql.exec('SELECT state, seek_id, expires_at FROM seek WHERE one = 1').toArray()[0]
    ws.send(encodeSnapshot('gateway', { seek: seekRow ?? null }, seq))
  }

  // ---- alarm: single alarm scheduled to the earliest pending expiry ----

  async alarm() {
    const now = nowMs()
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', now)
    this.ctx.storage.sql.exec('DELETE FROM nonces WHERE expires_at <= ?', now)
    this.ctx.storage.sql.exec('DELETE FROM idempotency WHERE expires_at <= ?', now)
    this.ctx.storage.sql.exec(
      'DELETE FROM events WHERE created_at <= ? AND seq NOT IN (SELECT seq FROM events ORDER BY seq DESC LIMIT ?)',
      now - LIMITS.eventRetentionMs, LIMITS.eventRetentionRows
    )
    const seekRow = this.ctx.storage.sql.exec('SELECT state, expires_at, reservation_id FROM seek WHERE one = 1').toArray()[0]
    if (seekRow && seekRow.expires_at <= now) {
      if (seekRow.state === 'reserved') {
        this.ctx.storage.sql.exec("UPDATE seek SET state = 'seeking', reservation_id = NULL WHERE one = 1")
      } else {
        this.ctx.storage.sql.exec('DELETE FROM seek WHERE one = 1')
      }
    }
    await this.scheduleNextAlarm()
  }

  async scheduleNextAlarm() {
    const candidates = [
      this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM sessions').toArray()[0]?.t,
      this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM nonces').toArray()[0]?.t,
      this.ctx.storage.sql.exec('SELECT MIN(expires_at) AS t FROM idempotency').toArray()[0]?.t,
      this.ctx.storage.sql.exec('SELECT expires_at AS t FROM seek WHERE one = 1').toArray()[0]?.t,
    ].filter(value => typeof value === 'number')
    if (candidates.length === 0) return
    await this.ctx.storage.setAlarm(Math.min(...candidates))
  }
}
