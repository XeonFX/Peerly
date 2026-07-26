import { DurableObject } from 'cloudflare:workers'
import { GatewayRuntime } from '../../../dist/adapters/durableObject/gatewayRuntime.js'
import {
  createSqlGatewayStorage, GATEWAY_SCHEMA,
} from '../../../dist/adapters/durableObject/sqlGatewayStorage.js'
import { createCoreHandlers } from '../../../dist/app/index.js'
import { coreCommands } from '../../../dist/protocol/index.js'
import { deriveScopeRouteId } from '../crypto.mjs'

const PING = 'ping'
const PONG = 'pong'

/**
 * Builds the `UserGatewayDO` class for one app.
 *
 * The class is deliberately thin — schema, sockets, and RPC plumbing — with
 * every rule living in `GatewayRuntime` and the layers beneath it, where it
 * can be tested without standing a Durable Object up. An app passes its own
 * commands and handlers rather than editing a switch in shared code, which is
 * what keeps one app's product concepts out of the other app's deployment.
 *
 * @param app.commands   extra command specs registered beside the core set
 * @param app.schema     extra DDL applied alongside the shared tables
 * @param app.handlers   built per request from the object's own collaborators
 * @param app.alarmCandidates  extra expiries for the single shared alarm
 * @param app.rpc        extra RPC methods, built from the object's own state.
 *                       Named separately in `app.rpcNames` because Durable
 *                       Object RPC dispatches on the prototype, so the methods
 *                       have to exist before any instance does.
 */
export function defineUserGateway(app = {}) {
  class UserGatewayDO extends DurableObject {
    constructor(ctx, env) {
      super(ctx, env)
      ctx.blockConcurrencyWhile(async () => {
        ctx.storage.sql.exec(GATEWAY_SCHEMA)
        if (app.schema) ctx.storage.sql.exec(app.schema)
      })
      // Answered by the runtime without waking the object, which is why the
      // client's keepalive costs nothing.
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
    }

    /** Read from the binding's env, never from the object's own id: a Durable
     *  Object cannot recover the name it was addressed by. */
    get appName() {
      const name = this.env.APP_ID?.trim()
      if (!name) throw new Error('APP_ID is required for UserGatewayDO')
      return name
    }

    get runtime() {
      if (this._runtime) return this._runtime
      const sql = this.ctx.storage.sql
      const storage = createSqlGatewayStorage(sql)
      const clock = { nowMs: () => Date.now() }
      const random = { uuid: () => crypto.randomUUID() }

      const runtime = new GatewayRuntime({
        ctx: this.ctx,
        storage,
        clock,
        random,
        registry: coreCommands().extend(app.commands ?? []),
        handlers: {
          ...createCoreHandlers({
            storage,
            clock,
            random,
            sockets: { all: () => [], others: () => [] },
            deriveRouteId: (kind, capability) =>
              deriveScopeRouteId(this.env.OPAQUE_USER_ID_SECRET, this.appName, kind, capability),
            scopes: this.scopeAuthorizer(),
            peers: this.peerDelivery(),
            emit: events => runtime.emit(events),
          }),
          ...(app.handlers?.({
            sql,
            clock,
            env: this.env,
            appName: this.appName,
            identity: () => storage.identity.current(),
            emit: (events, mailbox, uid) => runtime.emit(events, mailbox, uid),
          }) ?? {}),
        },
        presence: this.presencePublisher(),
        snapshot: () => app.snapshot?.(sql) ?? {},
        alarmCandidates: () => app.alarmCandidates?.(sql) ?? [],
        onAlarm: nowMs => app.onAlarm?.(sql, nowMs),
      })
      this._runtime = runtime
      return runtime
    }

    scopeAuthorizer() {
      if (!this.env.SIGNAL_SCOPES) return null
      const namespace = this.env.SIGNAL_SCOPES
      const appName = this.appName
      return {
        authorize: (routeId, uid, dk, expiresAt) =>
          namespace.getByName(`${appName}:${routeId}`).authorize({ uid, dk, expiresAt }),
        release: (routeId, uid, dk) =>
          namespace.getByName(`${appName}:${routeId}`).release({ uid, dk }).catch(() => {}),
      }
    }

    peerDelivery() {
      if (!this.env.USER_GATEWAYS) return null
      const namespace = this.env.USER_GATEWAYS
      const appName = this.appName
      return {
        deliver: (uid, events, mailbox) =>
          namespace.getByName(`${appName}:${uid}`).deliver({ uid, events, mailbox }),
      }
    }

    presencePublisher() {
      if (!this.env.PRESENCE_STATS) return null
      const namespace = this.env.PRESENCE_STATS
      const appName = this.appName
      return {
        publish: (uid, expiresAt) =>
          namespace.getByName(`${appName}:0`).presenceUpsert({ uid, expiresAt }),
      }
    }

    // ---- HTTP: WebSocket upgrade only; everything else is RPC ----

    async fetch(request) {
      const uid = request.headers.get('x-realtime-uid')
      const dk = request.headers.get('x-realtime-dk')
      const sid = request.headers.get('x-realtime-sid')
      if (!uid || !dk || !sid) return new Response('Unauthorized', { status: 401 })

      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      const accepted = await this.runtime.accept(server, { uid, deviceKeyId: dk, sid })
      if (!accepted.ok) return new Response('Unauthorized', { status: accepted.status })
      return new Response(null, { status: 101, webSocket: client })
    }

    async webSocketMessage(ws, message) {
      await this.runtime.onMessage(ws, message)
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

    // ---- RPC, called by Worker routes and sibling objects ----

    async registerSession({ dk, now, ttlMs, uid }) {
      const result = this.runtime.registerSession({
        deviceKeyId: dk, nowMs: now ?? Date.now(), ttlMs, uid,
      })
      if ('error' in result) return { code: 'invalid-device' }
      await this.runtime.scheduleAlarm()
      return result
    }

    async validateSession({ sid, dk, epoch, uid }) {
      return { ok: this.runtime.validateSession({ sid, deviceKeyId: dk, epoch, uid }) }
    }

    async consumeNonce(hashHex, expiresAt, uid) {
      const fresh = this.runtime.consumeNonce(hashHex, expiresAt, uid)
      if (fresh) await this.runtime.scheduleAlarm()
      return fresh
    }

    async deliver({ events = [], mailbox, uid }) {
      await this.runtime.emit(events, mailbox && {
        inviteId: mailbox.inviteId ?? mailbox.invite_id,
        body: mailbox.body,
      }, uid)
      return { ok: true }
    }

    appRpc() {
      if (!this._appRpc) {
        this._appRpc = app.rpc?.({
          sql: this.ctx.storage.sql,
          clock: { nowMs: () => Date.now() },
          env: this.env,
          appName: this.appName,
          emit: (events, mailbox, uid) => this.runtime.emit(events, mailbox, uid),
          scheduleAlarm: () => this.runtime.scheduleAlarm(),
        }) ?? {}
      }
      return this._appRpc
    }
  }

  for (const name of app.rpcNames ?? []) {
    UserGatewayDO.prototype[name] = function callAppRpc(...args) {
      return this.appRpc()[name](...args)
    }
  }
  return UserGatewayDO
}

/** The gateway for an app with no commands of its own. */
export const UserGatewayDO = defineUserGateway()
