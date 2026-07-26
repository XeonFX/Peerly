/**
 * The control socket's command loop.
 *
 * Everything here is expressed against ports, so the whole loop — version
 * negotiation, rate limiting, idempotency, dispatch, error reporting — runs
 * in plain Vitest against in-memory storage. That is the point: the previous
 * version of this logic lived inside a Durable Object and could only be
 * exercised by standing one up, so its tests reached past it to the RPCs and
 * never covered the loop at all.
 */
import { CLIENT_TIMINGS, LIMITS } from '../protocol/limits.js'
import {
  CLOSE, encodeAck, encodeBye, encodeDelta, encodeError, encodeSnapshot, FrameError,
  parseEnvelope, type ErrorCode,
} from '../protocol/frames.js'
import type { CommandRegistry, HelloPayload, ResumePayload } from '../protocol/commands.js'
import type { DeviceKeyId, OpaqueUserId } from '../protocol/ids.js'
import { planResume } from '../domain/eventStream.js'
import { createBucket, take, type Bucket } from '../domain/rateLimit.js'
import type { Clock, ControlSocket, GatewayStorage } from '../ports/index.js'

export type CommandContext = {
  readonly identity: OpaqueUserId
  readonly deviceKeyId: DeviceKeyId
  readonly socket: ControlSocket
}

/**
 * Returns the ack result, or throws. A handler that wants to report a
 * business failure throws `FrameError` with the right code; anything else it
 * throws is a bug and is reported as `internal` rather than silently dropped.
 */
export type CommandHandler = (payload: never, context: CommandContext) => Promise<unknown> | unknown

export type GatewayServiceOptions = {
  readonly storage: GatewayStorage
  readonly clock: Clock
  readonly registry: CommandRegistry
  readonly handlers: Readonly<Record<string, CommandHandler>>
  /** Snapshot handed to a client whose resume cursor has aged out. */
  readonly snapshot: () => unknown
}

const COMMANDS_POLICY = {
  burst: LIMITS.commandsBurst,
  sustainedPerSecond: LIMITS.commandsSustained,
}

export class GatewayService {
  private readonly options: GatewayServiceOptions
  /** In-memory only. Losing a bucket to hibernation refills tokens, which can
   *  never grant more allowance than the policy already permits. */
  private readonly buckets = new Map<string, Bucket>()

  constructor(options: GatewayServiceOptions) {
    this.options = options
  }

  forgetSocket(socketId: string): void {
    this.buckets.delete(socketId)
  }

  async handleMessage(socket: ControlSocket, raw: unknown): Promise<void> {
    const { clock, storage, registry } = this.options

    let envelope
    try {
      envelope = parseEnvelope(raw, LIMITS.controlFrameBytes)
    } catch (error) {
      return this.reject(socket, error)
    }

    // Version negotiation happens before anything else can be dispatched, and
    // a mismatch closes 4002 so the client reaches its terminal upgrade state
    // instead of retrying forever against a server it cannot talk to.
    if (!socket.negotiated()) {
      if (envelope.type !== 'hello') {
        socket.send(encodeBye(envelope.id, CLOSE.MALFORMED_FRAME))
        return socket.close(CLOSE.MALFORMED_FRAME, 'expected hello')
      }
      let hello: HelloPayload
      try {
        hello = registry.validate('hello', envelope.payload) as HelloPayload
      } catch (error) {
        return this.reject(socket, error)
      }
      if (hello.version !== LIMITS.protocolVersion) {
        socket.send(encodeBye(envelope.id, CLOSE.VERSION_UNSUPPORTED))
        return socket.close(CLOSE.VERSION_UNSUPPORTED, 'unsupported protocol version')
      }
      socket.markNegotiated()
      socket.send(encodeAck(envelope.id))
      if (typeof hello.resumeSeq === 'number') this.sendResume(socket, envelope.id, hello.resumeSeq)
      return
    }

    const nowMs = clock.nowMs()
    const bucket = this.buckets.get(socket.id) ?? createBucket(COMMANDS_POLICY, nowMs)
    const decision = take(bucket, COMMANDS_POLICY, nowMs)
    this.buckets.set(socket.id, decision.bucket)
    if (!decision.allowed) {
      return socket.send(encodeError('rate-limited', {
        forId: envelope.id,
        retryable: true,
        retryAfterMs: decision.retryAfterMs,
      }))
    }

    if (envelope.type === 'resume') {
      let resume: ResumePayload
      try {
        resume = registry.validate('resume', envelope.payload) as ResumePayload
      } catch (error) {
        return this.reject(socket, error)
      }
      return this.sendResume(socket, envelope.id, resume.fromSeq)
    }

    // A repeated command must repeat its original answer, never re-execute.
    const remembered = storage.idempotency.recall(envelope.id)
    if (remembered !== undefined) return socket.send(remembered)

    const identity = storage.identity.current()
    if (!identity) {
      return socket.send(encodeError('auth-required', { forId: envelope.id }))
    }

    let payload: unknown
    try {
      payload = registry.validate(envelope.type, envelope.payload)
    } catch (error) {
      return this.reject(socket, error, envelope.id)
    }

    const handler = this.options.handlers[envelope.type]
    if (!handler) {
      return socket.send(encodeError('not-found', { forId: envelope.id }))
    }

    // The dispatcher owns the try/catch so a handler can never leave a command
    // unanswered. Previously a throw inside a handler produced no ack, no
    // error and no idempotency row, and the client sat until its 15s timeout.
    let ack: string
    try {
      const result = await handler(payload as never, {
        identity,
        deviceKeyId: socket.deviceKeyId,
        socket,
      })
      ack = encodeAck(envelope.id, result)
    } catch (error) {
      const code: ErrorCode = error instanceof FrameError ? error.code : 'internal'
      return socket.send(encodeError(code, { forId: envelope.id, retryable: code === 'internal' }))
    }

    storage.idempotency.remember(
      envelope.id,
      ack,
      this.options.clock.nowMs() + LIMITS.idempotencyTtlMs
    )
    socket.send(ack)
  }

  /** Answer a rejected frame: close on a fatal shape, error frame otherwise. */
  private reject(socket: ControlSocket, error: unknown, forId?: string): void {
    if (!(error instanceof FrameError)) {
      socket.send(encodeError('internal', { forId, retryable: true }))
      return
    }
    if (error.close !== null) {
      if (forId) socket.send(encodeBye(forId, error.close))
      socket.close(error.close, error.message)
      return
    }
    socket.send(encodeError(error.code, { forId }))
  }

  private sendResume(socket: ControlSocket, frameId: string, fromSeq: number): void {
    const { events } = this.options.storage
    const plan = planResume(fromSeq, events.oldestSeq(), events.latestSeq())
    if (plan.kind === 'up-to-date') return
    if (plan.kind === 'snapshot') {
      socket.send(encodeSnapshot(frameId, 'gateway', this.options.snapshot(), events.latestSeq()))
      return
    }
    const rows = events.since(plan.fromSeq)
    if (rows.length === 0) return
    socket.send(encodeDelta(frameId, rows, rows[rows.length - 1].seq))
  }
}

export const GATEWAY_COMMAND_TIMEOUT_MS = CLIENT_TIMINGS.commandTimeoutMs
