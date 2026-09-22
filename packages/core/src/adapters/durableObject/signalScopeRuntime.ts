/**
 * Binds signalling-scope behaviour to one Durable Object instance.
 *
 * Structural, like `GatewayRuntime`: nothing here imports `cloudflare:workers`,
 * so the app's worker keeps a thin class and every rule below is exercised
 * from plain objects.
 */
import { LIMITS } from '../../protocol/limits.js'
import { CLOSE, encodeError, encodeFrame, FrameError, parseEnvelope } from '../../protocol/frames.js'
import { signalCommand, type SignalPayload } from '../../protocol/commands.js'
import { claimableTopics, isScopeAbandoned, routeSignal, type Participant } from '../../domain/signalRouting.js'
import { createBucket, take, type Bucket } from '../../domain/rateLimit.js'
import type { Clock, Random } from '../../ports/index.js'

const SIGNALS_POLICY = {
  burst: LIMITS.signalsBurst,
  sustainedPerSecond: LIMITS.signalsSustained,
}

export interface ScopeSocket {
  send(data: string): void
  close(code: number, reason: string): void
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

export interface ScopeContext {
  getWebSockets(): ScopeSocket[]
  acceptWebSocket(socket: ScopeSocket): void
  storage: {
    setAlarm(timestampMs: number): Promise<void>
    getAlarm(): Promise<number | null>
    deleteAll(): Promise<void>
  }
}

export type Authorization = {
  readonly uid: string
  readonly deviceKeyId: string
  readonly expiresAtMs: number
}

/** Storage this scope needs; narrow enough to fake in a test. */
export interface ScopeStore {
  authorize(record: Authorization): void
  find(uid: string, deviceKeyId: string): Authorization | undefined
  remove(uid: string, deviceKeyId: string): void
  count(): number
  deleteExpired(nowMs: number): void
  earliestExpiryMs(): number | null
}

type Attachment = { cid: string; uid: string; dk: string; topics: string[] }

export type SignalScopeRuntimeOptions = {
  readonly ctx: ScopeContext
  readonly store: ScopeStore
  readonly clock: Clock
  readonly random: Random
}

export class SignalScopeRuntime {
  private readonly options: SignalScopeRuntimeOptions
  private readonly buckets = new Map<string, Bucket>()

  constructor(options: SignalScopeRuntimeOptions) {
    this.options = options
  }

  async authorize(record: Authorization): Promise<{ ok: true } | { code: 'cap-exceeded' }> {
    const { store, ctx } = this.options
    const existing = store.find(record.uid, record.deviceKeyId)
    // The cap counts authorizations, not sockets, and is doubled because a
    // participant may hold one while reconnecting.
    if (!existing && store.count() >= LIMITS.participantsPerScope * 2) return { code: 'cap-exceeded' }
    store.authorize(record)
    // Never push out an earlier alarm: a later-expiring authorization must not
    // delay pruning of one that expires sooner.
    const pending = await ctx.storage.getAlarm()
    if (pending === null || record.expiresAtMs < pending) await ctx.storage.setAlarm(record.expiresAtMs)
    return { ok: true }
  }

  /** Give up an authorization early, closing the socket it justified — leaving
   *  that socket open would defeat the point of releasing. */
  async release(uid: string, deviceKeyId: string): Promise<void> {
    this.options.store.remove(uid, deviceKeyId)
    for (const socket of this.options.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null
      if (attachment?.uid === uid && attachment.dk === deviceKeyId) {
        socket.close(CLOSE.AUTH_REQUIRED, 'scope left')
      }
    }
  }

  accept(
    socket: ScopeSocket,
    identity: { uid: string; deviceKeyId: string }
  ): { ok: true } | { ok: false; status: number } {
    const { store, ctx, clock, random } = this.options
    const authorization = store.find(identity.uid, identity.deviceKeyId)
    if (!authorization || authorization.expiresAtMs <= clock.nowMs()) return { ok: false, status: 403 }
    if (ctx.getWebSockets().length >= LIMITS.participantsPerScope) return { ok: false, status: 409 }

    const cid = random.uuid()
    ctx.acceptWebSocket(socket)
    socket.serializeAttachment({ cid, uid: identity.uid, dk: identity.deviceKeyId, topics: [] } satisfies Attachment)
    this.announce(socket, 'peer.join', { from: cid })
    return { ok: true }
  }

  onMessage(socket: ScopeSocket, message: unknown): void {
    let payload: SignalPayload
    try {
      const envelope = parseEnvelope(message, LIMITS.signalFrameBytes)
      if (envelope.type !== 'signal') throw new FrameError('unknown type', { close: CLOSE.MALFORMED_FRAME })
      payload = signalCommand.validate(envelope.payload) as SignalPayload
    } catch (error) {
      if (error instanceof FrameError && error.close !== null) {
        return socket.close(error.close, error.message)
      }
      return socket.send(encodeError('invalid-frame'))
    }

    const attachment = socket.deserializeAttachment() as Attachment
    const nowMs = this.options.clock.nowMs()
    const bucket = this.buckets.get(attachment.cid) ?? createBucket(SIGNALS_POLICY, nowMs)
    const decision = take(bucket, SIGNALS_POLICY, nowMs)
    this.buckets.set(attachment.cid, decision.bucket)
    if (!decision.allowed) return socket.close(CLOSE.RATE_LIMIT_ABUSE, 'signal rate limit')

    if (payload.subscribe) {
      const overhead = JSON.stringify({ ...attachment, topics: [] }).length
      socket.serializeAttachment({ ...attachment, topics: claimableTopics(payload.subscribe, overhead) })
      return
    }

    const outgoing = encodeFrame('signal', {
      id: this.options.random.uuid(),
      payload: { ...payload, from: attachment.cid },
    })
    const participants: Participant[] = this.options.ctx.getWebSockets().map(other => {
      const other_ = other.deserializeAttachment() as Attachment
      return { cid: other_.cid, topics: other_.topics ?? [] }
    })
    const routing = routeSignal(payload, participants, attachment.cid)

    for (const other of this.options.ctx.getWebSockets()) {
      const target = other.deserializeAttachment() as Attachment
      if (routing.kind === 'direct' && target.cid !== routing.cid) continue
      if (routing.kind === 'topic' && !routing.cids.includes(target.cid)) continue
      if (routing.kind === 'broadcast' && other === socket) continue
      other.send(outgoing)
    }
  }

  async onClose(socket: ScopeSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment | null
    if (attachment) this.buckets.delete(attachment.cid)
    this.announce(socket, 'peer.leave', { from: attachment?.cid })
    // The runtime still lists the closing socket, so exclude it explicitly.
    const remaining = this.options.ctx.getWebSockets().filter(other => other !== socket).length
    if (isScopeAbandoned(remaining, this.options.store.count())) {
      await this.options.ctx.storage.deleteAll()
    }
  }

  async onAlarm(): Promise<void> {
    const { store, ctx } = this.options
    store.deleteExpired(this.options.clock.nowMs())
    const next = store.earliestExpiryMs()
    if (next !== null) return ctx.storage.setAlarm(next)
    if (isScopeAbandoned(ctx.getWebSockets().length, store.count())) await ctx.storage.deleteAll()
  }

  private announce(self: ScopeSocket, type: string, payload: unknown): void {
    const message = encodeFrame(type, { id: this.options.random.uuid(), payload })
    for (const other of this.options.ctx.getWebSockets()) {
      if (other !== self) other.send(message)
    }
  }
}
