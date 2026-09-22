import { DurableObject } from 'cloudflare:workers'
import { SignalScopeRuntime } from '../../../dist/adapters/durableObject/signalScopeRuntime.js'
import { createSqlScopeStore, SCOPE_SCHEMA } from '../../../dist/adapters/durableObject/sqlScopeStore.js'

/**
 * One scope per active signalling route (a chat, DM, room or workspace).
 * Forwards opaque offer/answer/ICE envelopes between authorized participants
 * and never parses or persists their contents.
 *
 * Thin by design: schema and sockets here, every rule in `SignalScopeRuntime`
 * and the domain beneath it, where it is tested without a Durable Object.
 */
export class SignalScopeDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(SCOPE_SCHEMA)
    })
  }

  get runtime() {
    if (!this._runtime) {
      this._runtime = new SignalScopeRuntime({
        ctx: this.ctx,
        store: createSqlScopeStore(this.ctx.storage.sql),
        clock: { nowMs: () => Date.now() },
        random: { uuid: () => crypto.randomUUID() },
      })
    }
    return this._runtime
  }

  async authorize({ uid, dk, expiresAt }) {
    return this.runtime.authorize({ uid, deviceKeyId: dk, expiresAtMs: expiresAt })
  }

  async release({ uid, dk }) {
    await this.runtime.release(uid, dk)
    return { ok: true }
  }

  async fetch(request) {
    const uid = request.headers.get('x-realtime-uid')
    const dk = request.headers.get('x-realtime-dk')
    if (!uid || !dk) return new Response('Unauthorized', { status: 401 })

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    const accepted = this.runtime.accept(server, { uid, deviceKeyId: dk })
    if (!accepted.ok) {
      return new Response(accepted.status === 409 ? 'Scope is full' : 'Forbidden', { status: accepted.status })
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, message) {
    this.runtime.onMessage(ws, message)
  }

  async webSocketClose(ws) {
    await this.runtime.onClose(ws)
  }

  async webSocketError(ws) {
    await this.runtime.onClose(ws)
  }

  async alarm() {
    await this.runtime.onAlarm()
  }
}
