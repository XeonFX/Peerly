import { DurableObject } from 'cloudflare:workers'

const AUTH_TTL_MAX_MS = 5 * 60_000
const DEFAULT_FRAME_BYTES = 48 * 1024
const DEFAULT_HISTORY_EVENTS = 1_000
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const RATE_WINDOW_MS = 10_000
const RATE_WINDOW_EVENTS = 100
const MAX_AUTHORITY_MEMBERS = 500

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channel_authority (
  one INTEGER PRIMARY KEY CHECK (one = 1),
  version INTEGER NOT NULL,
  owner TEXT,
  fingerprint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_members (
  principal_id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS channel_authorizations (
  uid TEXT NOT NULL,
  dk TEXT NOT NULL,
  user_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (uid, dk)
);
CREATE INDEX IF NOT EXISTS channel_auth_exp
  ON channel_authorizations(expires_at);
CREATE TABLE IF NOT EXISTS channel_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  event TEXT NOT NULL,
  data TEXT NOT NULL,
  target_user_id TEXT,
  sender_user_id TEXT NOT NULL,
  sender_dk TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS channel_events_created
  ON channel_events(created_at);
`

const attachmentOf = socket => socket.deserializeAttachment()
const isBounded = (value, max) =>
  typeof value === 'string' && value.length > 0 && value.length <= max

/**
 * Product-neutral encrypted event channel.
 *
 * An app owns the authority proof (workspace creator signature, friendship,
 * entitlement, and so on) and calls `authorize()` only after validating it.
 * This object owns the generic invariants after that boundary: monotonic
 * authority revisions, member revocation, authenticated hibernatable sockets,
 * persist-before-fan-out, idempotency, bounded history, and retention.
 */
export function defineAuthorizedChannel(options) {
  const allowedEvents = new Set(options.allowedEvents ?? [])
  const persistedEvents = new Set(options.persistedEvents ?? [])
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_FRAME_BYTES
  const maxHistoryEvents = options.maxHistoryEvents ?? DEFAULT_HISTORY_EVENTS
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS

  for (const event of persistedEvents) {
    if (!allowedEvents.has(event)) {
      throw new Error(`persisted event is not allowed: ${event}`)
    }
  }

  return class AuthorizedChannelDO extends DurableObject {
    constructor(ctx, env) {
      super(ctx, env)
      ctx.blockConcurrencyWhile(async () => {
        ctx.storage.sql.exec(SCHEMA)
        if (!ctx.storage.sql.exec('PRAGMA table_info(channel_authority)').toArray()
          .some(column => column.name === 'owner')) {
          ctx.storage.sql.exec('ALTER TABLE channel_authority ADD COLUMN owner TEXT')
        }
      })
    }

    /**
     * Installs a newer authority snapshot and grants a short socket lease.
     *
     * `principalId` and `members` are deliberately opaque. Peerly uses a
     * deployment-keyed email HMAC for workspace membership and a public OIDC
     * account id for a two-person DM. The reusable channel never learns why a
     * principal is entitled to join.
     */
    async authorize({
      uid,
      publicUserId,
      deviceKeyId,
      principalId,
      expiresAt,
      authority,
    }) {
      const now = Date.now()
      const members = [...new Set(authority?.members ?? [])].sort()
      if (
        !isBounded(uid, 128) ||
        !isBounded(publicUserId, 128) ||
        !isBounded(deviceKeyId, 256) ||
        !isBounded(principalId, 128) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= now ||
        !Number.isSafeInteger(authority?.version) ||
        authority.version < 0 ||
        !isBounded(authority?.fingerprint, 512) ||
        !isBounded(authority?.owner, 512) ||
        members.length === 0 ||
        members.length > MAX_AUTHORITY_MEMBERS ||
        members.some(member => !isBounded(member, 128))
      ) {
        return { code: 'auth-required' }
      }

      const current = this.ctx.storage.sql.exec(
        'SELECT version, fingerprint, owner FROM channel_authority WHERE one = 1'
      ).toArray()[0]
      // An old unpinned channel is never silently claimed by the next caller.
      // Apps migrate to owner-bound routes before using this authorization.
      if (current && current.owner !== authority.owner) {
        return { code: 'authority-conflict' }
      }
      if (current && authority.version < current.version) {
        return { code: 'stale-authority' }
      }
      if (
        current &&
        authority.version === current.version &&
        authority.fingerprint !== current.fingerprint
      ) {
        return { code: 'authority-conflict' }
      }

      if (!current || authority.version > current.version) {
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO channel_authority (one, version, fingerprint, owner)
           VALUES (1, ?, ?, ?)`,
          authority.version,
          authority.fingerprint,
          authority.owner
        )
        this.ctx.storage.sql.exec('DELETE FROM channel_members')
        for (const member of members) {
          this.ctx.storage.sql.exec(
            'INSERT INTO channel_members (principal_id) VALUES (?)',
            member
          )
        }
        this.dropRevokedSockets()
      }

      const admitted = this.ctx.storage.sql.exec(
        'SELECT 1 AS present FROM channel_members WHERE principal_id = ?',
        principalId
      ).toArray()[0]
      if (!admitted) return { code: 'forbidden' }

      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO channel_authorizations
           (uid, dk, user_id, principal_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        uid,
        deviceKeyId,
        publicUserId,
        principalId,
        Math.min(expiresAt, now + AUTH_TTL_MAX_MS)
      )
      return { ok: true }
    }

    async fetch(request) {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 })
      }
      const uid = request.headers.get('x-realtime-uid')
      const deviceKeyId = request.headers.get('x-realtime-dk')
      const publicUserId = request.headers.get('x-realtime-user')
      if (!uid || !deviceKeyId || !publicUserId) {
        return new Response('Unauthorized', { status: 401 })
      }

      const now = Date.now()
      this.ctx.storage.sql.exec(
        'DELETE FROM channel_authorizations WHERE expires_at <= ?',
        now
      )
      this.pruneHistory(now)
      const authorization = this.ctx.storage.sql.exec(
        `SELECT user_id, principal_id FROM channel_authorizations
         WHERE uid = ? AND dk = ? AND expires_at > ?`,
        uid,
        deviceKeyId,
        now
      ).toArray()[0]
      if (!authorization || authorization.user_id !== publicUserId) {
        return new Response('Unauthorized', { status: 401 })
      }
      const admitted = this.ctx.storage.sql.exec(
        'SELECT 1 AS present FROM channel_members WHERE principal_id = ?',
        authorization.principal_id
      ).toArray()[0]
      if (!admitted) return new Response('Forbidden', { status: 403 })

      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.ctx.acceptWebSocket(server)
      const connectionId = crypto.randomUUID()
      server.serializeAttachment({
        connectionId,
        uid,
        userId: publicUserId,
        principalId: authorization.principal_id,
        deviceKeyId,
        rateWindowAt: now,
        rateCount: 0,
      })
      server.send(JSON.stringify({
        type: 'snapshot',
        connectionId,
        members: this.members(),
        events: this.historyFor(publicUserId),
      }))
      this.broadcastMembers()
      return new Response(null, { status: 101, webSocket: client })
    }

    async webSocketMessage(socket, raw) {
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
      if (new TextEncoder().encode(text).byteLength > maxFrameBytes) {
        socket.close(1009, 'frame too large')
        return
      }
      let frame
      try {
        frame = JSON.parse(text)
      } catch {
        return
      }
      const sender = attachmentOf(socket)
      if (
        !sender ||
        frame?.type !== 'event' ||
        !isBounded(frame.event, 64) ||
        !allowedEvents.has(frame.event) ||
        !isBounded(frame.messageId, 80) ||
        (frame.target !== undefined && !isBounded(frame.target, 128))
      ) {
        return this.sendError(socket, frame?.messageId, 'invalid-frame')
      }

      const now = Date.now()
      const inCurrentWindow = now - sender.rateWindowAt < RATE_WINDOW_MS
      const rateCount = inCurrentWindow ? sender.rateCount + 1 : 1
      const rateWindowAt = inCurrentWindow ? sender.rateWindowAt : now
      socket.serializeAttachment({ ...sender, rateCount, rateWindowAt })
      if (rateCount > RATE_WINDOW_EVENTS) {
        socket.close(1008, 'rate limit')
        return
      }
      if (!this.validEncryptedData(frame.data)) {
        return this.sendError(socket, frame.messageId, 'invalid-ciphertext')
      }

      const outbound = JSON.stringify({
        type: 'event',
        event: frame.event,
        data: frame.data,
        senderUserId: sender.userId,
        senderDeviceKeyId: sender.deviceKeyId,
      })
      if (persistedEvents.has(frame.event)) {
        const duplicate = this.ctx.storage.sql.exec(
          'SELECT 1 AS present FROM channel_events WHERE message_id = ?',
          frame.messageId
        ).toArray()[0]
        if (duplicate) {
          this.sendAck(socket, frame.messageId)
          return
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO channel_events
             (message_id, event, data, target_user_id, sender_user_id, sender_dk, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          frame.messageId,
          frame.event,
          JSON.stringify(frame.data),
          frame.target ?? null,
          sender.userId,
          sender.deviceKeyId,
          now
        )
        this.ctx.storage.sql.exec(
          `DELETE FROM channel_events WHERE seq NOT IN
             (SELECT seq FROM channel_events ORDER BY seq DESC LIMIT ?)`,
          maxHistoryEvents
        )
        this.pruneHistory(now)
        await this.scheduleAlarm()
      }

      for (const peer of this.ctx.getWebSockets()) {
        if (peer === socket) continue
        const recipient = attachmentOf(peer)
        if (!recipient || (frame.target && recipient.userId !== frame.target)) continue
        try {
          peer.send(outbound)
        } catch {
          // The close/error callback handles stale hibernated sockets.
        }
      }
      this.sendAck(socket, frame.messageId)
    }

    async webSocketClose(socket) {
      this.broadcastMembers(socket)
    }

    async webSocketError(socket) {
      this.broadcastMembers(socket)
    }

    validEncryptedData(data) {
      return (
        data &&
        typeof data === 'object' &&
        data.v === 1 &&
        typeof data.iv === 'string' &&
        data.iv.length >= 16 &&
        data.iv.length <= 32 &&
        typeof data.ciphertext === 'string' &&
        data.ciphertext.length > 0 &&
        data.ciphertext.length <= maxFrameBytes
      )
    }

    members(exclude) {
      return this.ctx.getWebSockets().flatMap(socket => {
        if (socket === exclude) return []
        const value = attachmentOf(socket)
        return value
          ? [{
              connectionId: value.connectionId,
              userId: value.userId,
              deviceKeyId: value.deviceKeyId,
            }]
          : []
      })
    }

    historyFor(userId) {
      return this.ctx.storage.sql.exec(
        `SELECT event, data, sender_user_id, sender_dk
         FROM channel_events
         WHERE target_user_id IS NULL OR target_user_id = ? OR sender_user_id = ?
         ORDER BY seq ASC LIMIT ?`,
        userId,
        userId,
        maxHistoryEvents
      ).toArray().map(row => ({
        type: 'event',
        event: row.event,
        data: JSON.parse(row.data),
        senderUserId: row.sender_user_id,
        senderDeviceKeyId: row.sender_dk,
      }))
    }

    pruneHistory(now = Date.now()) {
      this.ctx.storage.sql.exec(
        'DELETE FROM channel_events WHERE created_at <= ?',
        now - retentionMs
      )
    }

    async scheduleAlarm() {
      const oldest = this.ctx.storage.sql.exec(
        'SELECT MIN(created_at) AS created_at FROM channel_events'
      ).toArray()[0]?.created_at
      if (typeof oldest === 'number') {
        await this.ctx.storage.setAlarm(oldest + retentionMs)
      }
    }

    async alarm() {
      const now = Date.now()
      this.ctx.storage.sql.exec(
        'DELETE FROM channel_authorizations WHERE expires_at <= ?',
        now
      )
      this.pruneHistory(now)
      await this.scheduleAlarm()
    }

    dropRevokedSockets() {
      const members = new Set(
        this.ctx.storage.sql.exec(
          'SELECT principal_id FROM channel_members'
        ).toArray().map(row => row.principal_id)
      )
      for (const socket of this.ctx.getWebSockets()) {
        const value = attachmentOf(socket)
        if (value && !members.has(value.principalId)) {
          socket.close(4003, 'membership revoked')
        }
      }
    }

    broadcastMembers(exclude) {
      const frame = JSON.stringify({
        type: 'members',
        members: this.members(exclude),
      })
      for (const socket of this.ctx.getWebSockets()) {
        if (socket === exclude) continue
        try {
          socket.send(frame)
        } catch {
          // Best-effort membership refresh.
        }
      }
    }

    sendAck(socket, messageId) {
      try {
        socket.send(JSON.stringify({ type: 'ack', messageId }))
      } catch {
        // The sender will reconnect and replay the same idempotent frame.
      }
    }

    sendError(socket, messageId, code) {
      if (!isBounded(messageId, 80)) return
      try {
        socket.send(JSON.stringify({ type: 'error', messageId, code }))
      } catch {
        // Socket teardown will reject or retry the pending client send.
      }
    }
  }
}
