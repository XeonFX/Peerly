/**
 * The interfaces the control plane needs from the outside world.
 *
 * Segregated on purpose: a handler that only reads the event stream should
 * not be handed something that can also revoke devices. The previous design
 * had one Durable Object class holding all of it, which is why nothing in it
 * could be tested without workerd.
 */
import type { DeviceKeyId, OpaqueUserId } from '../protocol/ids.js'
import type { SessionRecord } from '../domain/deviceRegistry.js'
import type { StoredEvent, StreamEvent } from '../domain/eventStream.js'

export interface Clock {
  nowMs(): number
}

export interface Random {
  uuid(): string
}

/**
 * Delayed work, as one pending promise.
 *
 * A port rather than a bare `setTimeout` for the same reason everything else
 * here is one: delta batching is decided by wall-clock windows, and a test
 * that had to wait them out in real time would be both slow and flaky. The
 * Durable Object supplies the real implementation.
 */
export interface Scheduler {
  after(ms: number): Promise<void>
}

/**
 * Which account this object serves.
 *
 * Deliberately a port with no constructor from an object id: a Durable Object
 * cannot read the name it was addressed by (`ctx.id.name` is `undefined`
 * inside the object even via `getByName`), and deriving identity from it gave
 * every account in both apps the same empty id. Identity arrives from an
 * authenticated caller and is remembered.
 */
export interface IdentityStore {
  current(): OpaqueUserId | null
  remember(uid: OpaqueUserId): void
}

export interface SessionStore {
  all(): readonly SessionRecord[]
  byId(sid: string): SessionRecord | undefined
  insert(session: SessionRecord): void
  deleteForDevice(deviceKeyId: DeviceKeyId): void
  deleteExpired(nowMs: number): void
  epochFor(deviceKeyId: DeviceKeyId): number | undefined
  setEpoch(deviceKeyId: DeviceKeyId, epoch: number): void
}

export interface NonceStore {
  /** True if the nonce was unused; false means replay. */
  consume(hash: string, expiresAtMs: number): boolean
  deleteExpired(nowMs: number): void
  earliestExpiryMs(): number | null
}

/** Replaying a command must repeat its original answer, never re-execute it. */
export interface IdempotencyStore {
  recall(commandId: string): string | undefined
  remember(commandId: string, ack: string, expiresAtMs: number): void
  deleteExpired(nowMs: number): void
  earliestExpiryMs(): number | null
}

export interface EventStore {
  append(events: readonly StreamEvent[], nowMs: number): readonly StoredEvent[]
  since(seq: number): readonly StoredEvent[]
  oldestSeq(): number | null
  latestSeq(): number
  prune(olderThanMs: number, keepNewest: number): void
}

export interface MailboxStore {
  put(inviteId: string, body: string, nowMs: number): void
  drop(inviteId: string): void
  count(): number
  /** Whether this id is already held, so a redelivery of an entry the mailbox
   *  has is not counted as a new occupant against the cap. */
  has(inviteId: string): boolean
  oldestId(): string | undefined
}

/** Everything one account's gateway persists. */
export type GatewayStorage = {
  readonly identity: IdentityStore
  readonly sessions: SessionStore
  readonly nonces: NonceStore
  readonly idempotency: IdempotencyStore
  readonly events: EventStore
  readonly mailbox: MailboxStore
}

/**
 * One connected control socket, as the application sees it.
 *
 * `negotiated` is a question asked of the socket rather than state the
 * service keeps, because it has to survive hibernation: the runtime may evict
 * every in-memory map between two frames on the same connection, and a socket
 * that forgot it had already said hello would be told to say it again.
 */
export interface ControlSocket {
  readonly id: string
  readonly deviceKeyId: DeviceKeyId
  /** Stable public account id from the authenticated session, when enabled. */
  readonly publicUserId?: string
  /** Deployment-private HMAC of the OIDC-verified normalized email. */
  readonly privateMemberId?: string
  negotiated(): boolean
  markNegotiated(): void
  send(frame: string): void
  close(code: number, reason: string): void
}

export interface SocketSet {
  all(): readonly ControlSocket[]
  /** Excludes `socket`, for the "is this the last one" decision that the
   *  runtime's own list gets wrong during a close. */
  others(socket: ControlSocket): readonly ControlSocket[]
}

/** Cross-object collaborators, absent on deployments that do not bind them. */
export interface PresencePublisher {
  publish(uid: OpaqueUserId, expiresAtMs: number): Promise<void>
}

export interface ScopeAuthorizer {
  authorize(routeId: string, uid: OpaqueUserId, deviceKeyId: DeviceKeyId, expiresAtMs: number): Promise<void>
  release(routeId: string, uid: OpaqueUserId, deviceKeyId: DeviceKeyId): Promise<void>
}

/** The recipient's answer: a full mailbox refuses rather than evicting, and
 *  the sender is told so instead of being told the invite was delivered. */
export type DeliveryResult = { ok: true } | { ok: false; code: 'mailbox-full' }

export interface GatewayPeers {
  deliver(
    uid: string,
    events: readonly StreamEvent[],
    mailbox?: { inviteId: string; body: string }
  ): Promise<DeliveryResult | void>
}

export interface AlarmScheduler {
  scheduleAt(timestampMs: number): Promise<void>
  pendingAt(): Promise<number | null>
}
