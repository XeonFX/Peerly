/**
 * Binds the gateway service to one Durable Object instance.
 *
 * Structural on purpose: nothing here imports `cloudflare:workers`. The app's
 * worker defines the three-line class that extends `DurableObject` and hands
 * this its `ctx`, which keeps core free of runtime types and — more usefully —
 * makes the whole runtime constructible from plain objects in a test.
 */
import { LIMITS } from '../../protocol/limits.js'
import { CLOSE } from '../../protocol/frames.js'
import type { CommandRegistry } from '../../protocol/commands.js'
import { asDeviceKeyId, asOpaqueUserId, type DeviceKeyId, type OpaqueUserId } from '../../protocol/ids.js'
import { decideEnrollment, isSessionValid } from '../../domain/deviceRegistry.js'
import { expiredLease, isLastSocket, leaseFor, renewAtMs } from '../../domain/presence.js'
import {
  addToBatch, EMPTY_BATCH, retentionCutoff, shouldFlush, type BatchState,
} from '../../domain/eventStream.js'
import type { StoredEvent, StreamEvent } from '../../domain/eventStream.js'
import type {
  Clock, ControlSocket, GatewayStorage, PresencePublisher, Random, Scheduler,
} from '../../ports/index.js'
import { GatewayService, type CommandHandler } from '../../app/gatewayService.js'
import { deliverToAccount, socketSetOf } from '../../app/coreHandlers.js'
import { encodeDelta } from '../../protocol/frames.js'

/** The slice of `DurableObjectState` this runtime uses. */
export interface ObjectContext {
  getWebSockets(): RawSocket[]
  acceptWebSocket(socket: RawSocket): void
  storage: {
    setAlarm(timestampMs: number): Promise<void>
    getAlarm(): Promise<number | null>
  }
}

export interface RawSocket {
  send(data: string): void
  close(code: number, reason: string): void
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

type Attachment = {
  readonly cid: string
  readonly dk: string
  readonly sid: string
  readonly negotiated: boolean
  readonly publicUserId?: string
  readonly privateMemberId?: string
}

export type GatewayRuntimeOptions = {
  readonly ctx: ObjectContext
  readonly storage: GatewayStorage
  readonly clock: Clock
  readonly random: Random
  readonly registry: CommandRegistry
  /** App handlers merged over the core ones; an app may not shadow a core
   *  command, which the registry already refuses at construction. */
  readonly handlers: Record<string, CommandHandler>
  readonly presence: PresencePublisher | null
  readonly scheduler: Scheduler
  /**
   * Event kinds that must go out on their own, immediately.
   *
   * The architecture names them: authentication, matching commit, revoke and
   * leave/close acknowledgements are never batched. Only `device.revoked` is
   * core's own — an app adds its kinds here rather than core learning about
   * them, which is the same boundary the command registry draws.
   */
  readonly urgentKinds?: ReadonlySet<string>
  readonly snapshot: () => unknown
  /** Extra expiries the app wants the shared alarm to respect. */
  readonly alarmCandidates?: () => readonly number[]
  readonly onAlarm?: (nowMs: number) => void | Promise<void>
}

export class GatewayRuntime {
  private readonly options: GatewayRuntimeOptions
  private readonly service: GatewayService
  private batch: BatchState = EMPTY_BATCH
  private flushArmed = false

  constructor(options: GatewayRuntimeOptions) {
    this.options = options
    this.service = new GatewayService({
      storage: options.storage,
      clock: options.clock,
      registry: options.registry,
      handlers: options.handlers,
      snapshot: options.snapshot,
    })
  }

  // ---- sockets -------------------------------------------------------------

  private wrap(raw: RawSocket): ControlSocket {
    const attachment = raw.deserializeAttachment() as Attachment
    return {
      id: attachment.cid,
      deviceKeyId: attachment.dk as DeviceKeyId,
      ...(attachment.publicUserId ? { publicUserId: attachment.publicUserId } : {}),
      ...(attachment.privateMemberId ? { privateMemberId: attachment.privateMemberId } : {}),
      negotiated: () => attachment.negotiated === true,
      markNegotiated: () => raw.serializeAttachment({ ...attachment, negotiated: true }),
      send: frame => raw.send(frame),
      close: (code, reason) => raw.close(code, reason),
    }
  }

  private sockets(): ControlSocket[] {
    return this.options.ctx.getWebSockets().map(raw => this.wrap(raw))
  }

  socketSet() {
    return socketSetOf(() => this.sockets())
  }

  /**
   * Accept an authenticated upgrade.
   *
   * The identity comes from the caller and is remembered, never derived from
   * the object's own id — `ctx.id.name` is `undefined` inside a Durable
   * Object, and parsing it gave every account the same empty identity.
   */
  async accept(
    raw: RawSocket,
    identity: {
      uid: string
      deviceKeyId: string
      sid: string
      publicUserId?: string
      privateMemberId?: string
    }
  ): Promise<{ ok: true } | { ok: false; status: number }> {
    const uid = asOpaqueUserId(identity.uid)
    const deviceKeyId = asDeviceKeyId(identity.deviceKeyId)
    if (!uid || !deviceKeyId) return { ok: false, status: 401 }

    const nowMs = this.options.clock.nowMs()
    const session = this.options.storage.sessions.byId(identity.sid)
    const currentEpoch = this.options.storage.sessions.epochFor(deviceKeyId) ?? session?.epoch ?? 0
    if (!isSessionValid(session, deviceKeyId, session?.epoch ?? -1, currentEpoch, nowMs)) {
      return { ok: false, status: 401 }
    }

    const open = this.options.ctx.getWebSockets()
    if (open.length >= LIMITS.controlSocketsPerAccount) {
      open[0].close(CLOSE.SLOW_CONSUMER, 'connection limit')
    }

    this.options.storage.identity.remember(uid)
    // Drain to the sockets that were already here. The arriving one catches up
    // from its own resume cursor, so letting it also receive a batch opened
    // before it existed would deliver those events to it twice.
    this.flushBatch()
    this.options.ctx.acceptWebSocket(raw)
    raw.serializeAttachment({
      cid: this.options.random.uuid(),
      dk: deviceKeyId,
      sid: identity.sid,
      negotiated: false,
      ...(identity.publicUserId ? { publicUserId: identity.publicUserId } : {}),
      ...(identity.privateMemberId ? { privateMemberId: identity.privateMemberId } : {}),
    } satisfies Attachment)

    await this.publishPresence(nowMs, true)
    await this.scheduleAlarm()
    return { ok: true }
  }

  async onMessage(raw: RawSocket, message: unknown): Promise<void> {
    await this.service.handleMessage(this.wrap(raw), message)
  }

  async onClose(raw: RawSocket): Promise<void> {
    const socket = this.wrap(raw)
    this.service.forgetSocket(socket.id)
    // The runtime still lists a closing socket here, so the raw count would
    // make "the last one left" look like "one remains" and the account would
    // never go offline.
    if (isLastSocket(this.options.ctx.getWebSockets(), raw)) {
      await this.publishPresence(this.options.clock.nowMs(), false)
    }
  }

  // ---- account state -------------------------------------------------------

  registerSession(input: { deviceKeyId: string; nowMs: number; ttlMs: number; uid?: string }) {
    const deviceKeyId = asDeviceKeyId(input.deviceKeyId)
    if (!deviceKeyId) return { error: 'invalid-device' as const }
    const uid = input.uid ? asOpaqueUserId(input.uid) : null
    if (uid) this.options.storage.identity.remember(uid)

    const { sessions } = this.options.storage
    sessions.deleteExpired(input.nowMs)

    const epochs = new Map<DeviceKeyId, number>()
    for (const session of sessions.all()) {
      const epoch = sessions.epochFor(session.deviceKeyId)
      if (epoch !== undefined) epochs.set(session.deviceKeyId, epoch)
    }

    const decision = decideEnrollment(
      sessions.all(), deviceKeyId, epochs, LIMITS.controlSocketsPerAccount, input.nowMs
    )
    if (decision.evict) {
      sessions.deleteForDevice(decision.evict)
      for (const socket of this.sockets()) {
        if (socket.deviceKeyId === decision.evict) socket.close(CLOSE.AUTH_REQUIRED, 'device limit reached')
      }
    }
    if (sessions.epochFor(deviceKeyId) === undefined) sessions.setEpoch(deviceKeyId, decision.epoch)

    const sid = this.options.random.uuid()
    sessions.insert({
      sid,
      deviceKeyId,
      epoch: decision.epoch,
      createdAtMs: input.nowMs,
      expiresAtMs: input.nowMs + input.ttlMs,
    })
    return { sid, epoch: decision.epoch }
  }

  validateSession(input: { sid: string; deviceKeyId: string; epoch: number; uid?: string }): boolean {
    const deviceKeyId = asDeviceKeyId(input.deviceKeyId)
    if (!deviceKeyId) return false
    const uid = input.uid ? asOpaqueUserId(input.uid) : null
    if (uid) this.options.storage.identity.remember(uid)
    const session = this.options.storage.sessions.byId(input.sid)
    const currentEpoch = this.options.storage.sessions.epochFor(deviceKeyId) ?? 0
    return isSessionValid(session, deviceKeyId, input.epoch, currentEpoch, this.options.clock.nowMs())
  }

  consumeNonce(hash: string, expiresAtMs: number, uid?: string): boolean {
    const parsed = uid ? asOpaqueUserId(uid) : null
    if (parsed) this.options.storage.identity.remember(parsed)
    return this.options.storage.nonces.consume(hash, expiresAtMs)
  }

  /**
   * Append events, push them to connected sockets, and store any mailbox copy.
   *
   * The append is always immediate — the stream is the durable record a
   * resuming client is owed, and nothing about batching may delay it. Only the
   * *send* is coalesced, into one `delta` frame per `batchWindowMs` under the
   * item and byte caps, which is what the cost model asks for and what the
   * declared batching constants were doing nothing about.
   */
  async emit(
    events: readonly StreamEvent[],
    mailbox?: { inviteId: string; body: string },
    uid?: string
  ): Promise<void> {
    const parsed = uid ? asOpaqueUserId(uid) : null
    if (parsed) this.options.storage.identity.remember(parsed)
    deliverToAccount(this.options.storage, this.options.clock, mailbox)
    if (events.length === 0) return

    const nowMs = this.options.clock.nowMs()
    const appended = this.options.storage.events.append(events, nowMs)

    if (appended.some(event => this.options.urgentKinds?.has(event.kind))) {
      // Anything already waiting goes first: a client applies deltas by
      // sequence, so overtaking a pending batch would deliver them backwards.
      this.flushBatch()
      this.sendDelta(appended)
      return
    }

    for (const event of appended) this.batch = addToBatch(this.batch, event, nowMs)
    if (shouldFlush(this.batch, nowMs)) this.flushBatch()
    else this.armFlush()
  }

  private sendDelta(events: readonly StoredEvent[]): void {
    if (events.length === 0) return
    const frame = encodeDelta(
      this.options.random.uuid(),
      events,
      events[events.length - 1].seq
    )
    for (const socket of this.sockets()) socket.send(frame)
  }

  private flushBatch(): void {
    const pending = this.batch
    this.batch = EMPTY_BATCH
    this.sendDelta(pending.events)
  }

  /** One pending flush at a time — never an interval, which would keep the
   *  object awake and bill for every tick whether or not anything was due. */
  private armFlush(): void {
    if (this.flushArmed) return
    this.flushArmed = true
    void this.options.scheduler.after(LIMITS.batchWindowMs).then(() => {
      this.flushArmed = false
      this.flushBatch()
    })
  }

  // ---- alarms and presence -------------------------------------------------

  private async publishPresence(nowMs: number, online: boolean): Promise<void> {
    const { presence, storage } = this.options
    const uid = storage.identity.current()
    if (!presence || !uid) return
    const lease = online ? leaseFor(nowMs) : expiredLease(nowMs)
    await presence.publish(uid, lease.expiresAtMs).catch(() => {})
  }

  async scheduleAlarm(): Promise<void> {
    const { storage, ctx, clock, presence } = this.options
    const candidates = [
      storage.nonces.earliestExpiryMs(),
      storage.idempotency.earliestExpiryMs(),
      ...(this.options.alarmCandidates?.() ?? []),
    ].filter((value): value is number => typeof value === 'number')

    const sessions = storage.sessions.all()
    if (sessions.length > 0) candidates.push(Math.min(...sessions.map(session => session.expiresAtMs)))
    // Keep waking to renew the lease while connected, so a silent but open
    // socket does not let the online count lapse at the lease TTL.
    if (presence && ctx.getWebSockets().length > 0) candidates.push(renewAtMs(clock.nowMs()))

    if (candidates.length === 0) return
    await ctx.storage.setAlarm(Math.min(...candidates))
  }

  async onAlarm(): Promise<void> {
    const nowMs = this.options.clock.nowMs()
    const { storage } = this.options
    storage.sessions.deleteExpired(nowMs)
    storage.nonces.deleteExpired(nowMs)
    storage.idempotency.deleteExpired(nowMs)
    const cutoff = retentionCutoff(nowMs)
    storage.events.prune(cutoff.olderThanMs, cutoff.keepNewest)
    await this.options.onAlarm?.(nowMs)
    await this.publishPresence(nowMs, this.options.ctx.getWebSockets().length > 0)
    await this.scheduleAlarm()
  }
}

export type { OpaqueUserId }
