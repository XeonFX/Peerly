import { DurableObject } from 'cloudflare:workers'
import { activeChannelSession, bindChannelSession, expireChannelSessions, revokeChannelSession } from './channelSessions.mjs'

const DEFAULT_FRAME_BYTES = 48 * 1024
const DEFAULT_MAX_CONNECTIONS = 1_000
const RATE_WINDOW_MS = 10_000
const RATE_WINDOW_EVENTS = 100

const attachmentOf = socket => socket.deserializeAttachment()
const isBounded = (value, max) =>
  typeof value === 'string' && value.length > 0 && value.length <= max

/**
 * Authenticated, hibernatable, non-persistent event channel.
 *
 * This is the shared primitive for public presence/invitation lobbies. The
 * edge Worker authenticates every upgrade and fixes the route; the object
 * keeps no mailbox or content history. Product code supplies only its bounded
 * event allow-list.
 */
export function defineEphemeralChannel(options) {
  const allowedEvents = new Set(options.allowedEvents ?? [])
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_FRAME_BYTES
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS

  return class EphemeralChannelDO extends DurableObject {
    async fetch(request) {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 })
      }
      const userId = request.headers.get('x-realtime-user')
      const deviceKeyId = request.headers.get('x-realtime-dk')
      const uid = request.headers.get('x-realtime-uid')
      const sid = request.headers.get('x-realtime-sid')
      if (!isBounded(userId, 128) || !isBounded(deviceKeyId, 256) || !uid || !sid) {
        return new Response('Unauthorized', { status: 401 })
      }
      if (this.ctx.getWebSockets().length >= maxConnections) {
        return new Response('Channel capacity reached', {
          status: 503,
          headers: { 'retry-after': '5' },
        })
      }

      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.ctx.acceptWebSocket(server)
      const now = Date.now()
      const connectionId = crypto.randomUUID()
      server.serializeAttachment({
        connectionId,
        uid,
        sid,
        userId,
        deviceKeyId,
        rateWindowAt: now,
        rateCount: 0,
      })
      if (!await bindChannelSession(this, server, 'LOBBY_CHANNELS')) {
        server.close(4001, 'invalid session')
        return new Response('Unauthorized', { status: 401 })
      }
      server.send(JSON.stringify({
        type: 'snapshot',
        connectionId,
        members: this.members(),
      }))
      this.broadcastMembers()
      return new Response(null, { status: 101, webSocket: client })
    }

    webSocketMessage(socket, raw) {
      if (!activeChannelSession(socket)) {
        socket.close(4001, 'session expired or revoked')
        return
      }
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
        this.sendError(socket, frame?.messageId, 'invalid-frame')
        return
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

      const outbound = JSON.stringify({
        type: 'event',
        event: frame.event,
        data: frame.data,
        senderUserId: sender.userId,
        senderDeviceKeyId: sender.deviceKeyId,
      })
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === socket || !activeChannelSession(peer)) continue
        const recipient = attachmentOf(peer)
        if (!recipient || (frame.target && recipient.userId !== frame.target)) continue
        try {
          peer.send(outbound)
        } catch {
          // Hibernation close/error callbacks refresh membership.
        }
      }
      this.sendAck(socket, frame.messageId)
    }

    webSocketClose(socket) {
      this.broadcastMembers(socket)
    }

    webSocketError(socket) {
      this.broadcastMembers(socket)
    }

    revokeSession(session) {
      const result = revokeChannelSession(this, session)
      this.broadcastMembers()
      return result
    }

    async alarm() {
      const next = expireChannelSessions(this)
      this.broadcastMembers()
      if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next)
    }

    members(exclude) {
      return this.ctx.getWebSockets().flatMap(socket => {
        if (socket === exclude || !activeChannelSession(socket)) return []
        const member = attachmentOf(socket)
        return member
          ? [{
              connectionId: member.connectionId,
              userId: member.userId,
              deviceKeyId: member.deviceKeyId,
            }]
          : []
      })
    }

    broadcastMembers(exclude) {
      const frame = JSON.stringify({
        type: 'members',
        members: this.members(exclude),
      })
      for (const socket of this.ctx.getWebSockets()) {
        if (socket === exclude || !activeChannelSession(socket)) continue
        try {
          socket.send(frame)
        } catch {
          // Best-effort presence refresh.
        }
      }
    }

    sendAck(socket, messageId) {
      if (!isBounded(messageId, 80)) return
      try {
        socket.send(JSON.stringify({ type: 'ack', messageId }))
      } catch {
        // The client reconnects and may safely resend this ephemeral frame.
      }
    }

    sendError(socket, messageId, code) {
      if (!isBounded(messageId, 80)) return
      try {
        socket.send(JSON.stringify({ type: 'error', messageId, code }))
      } catch {
        // Socket teardown rejects the pending client send.
      }
    }
  }
}
