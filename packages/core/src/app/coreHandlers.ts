/**
 * Handlers for the commands every app gets.
 *
 * Matchmaking and room directories are conspicuously absent: they belong to
 * the app that has them. The previous gateway hardcoded both in a shared
 * `switch`, so one app deployed the other's product code, inert.
 */
import { LIMITS } from '../protocol/limits.js'
import { FrameError } from '../protocol/frames.js'
import { nextEpoch } from '../domain/deviceRegistry.js'
import { createBucket, take, type Bucket } from '../domain/rateLimit.js'
import type {
  DeviceRevokePayload, InviteAckPayload, InviteSendPayload,
  RingSendPayload, ScopeLeavePayload, ScopeRequestPayload,
} from '../protocol/commands.js'
import type { OpaqueUserId } from '../protocol/ids.js'
import type {
  Clock, ControlSocket, GatewayPeers, GatewayStorage, Random, ScopeAuthorizer, SocketSet,
} from '../ports/index.js'
import type { CommandContext, CommandHandler } from './gatewayService.js'

export type CoreHandlerDeps = {
  readonly storage: GatewayStorage
  readonly clock: Clock
  readonly random: Random
  readonly sockets: SocketSet
  /** Derives the route id for a scope. App-supplied because the recipe is
   *  keyed by the deployment secret, which handlers must never see. */
  readonly deriveRouteId: (kind: string, capability: string) => Promise<string>
  readonly scopes: ScopeAuthorizer | null
  readonly peers: GatewayPeers | null
  /** Appends to the event stream and pushes to connected sockets. */
  readonly emit: (events: readonly { kind: string; body: Record<string, unknown> }[]) => Promise<void>
}

const required = <T>(value: T | null, what: string): T => {
  if (value === null) throw new FrameError(`${what} is not available`, { code: 'not-found' })
  return value
}

const DELIVERY_POLICY = {
  burst: LIMITS.deliveriesBurstPerRecipient,
  sustainedPerSecond: LIMITS.deliveriesSustainedPerRecipient,
}

/**
 * A per-recipient ceiling on `invite.send` and `ring.send`.
 *
 * Both commands name their target, and the command budget alone is a
 * per-socket allowance — so without this, an account could spend all of it on
 * one person: enough to fill a mailbox in seconds and to bill this account for
 * every write. The bucket map is bounded and in-memory, which only ever refills
 * tokens early, and the durable half of the protection is the mailbox refusing
 * to evict (see `deliverToAccount`).
 */
function createDeliveryLimiter(clock: Clock) {
  const buckets = new Map<string, Bucket>()
  return (recipient: string): void => {
    const nowMs = clock.nowMs()
    const decision = take(buckets.get(recipient) ?? createBucket(DELIVERY_POLICY, nowMs), DELIVERY_POLICY, nowMs)
    // Re-insert last so the map is ordered oldest-first for eviction.
    buckets.delete(recipient)
    buckets.set(recipient, decision.bucket)
    if (buckets.size > LIMITS.deliveryRecipientsTracked) {
      const oldest = buckets.keys().next()
      if (!oldest.done) buckets.delete(oldest.value)
    }
    if (!decision.allowed) {
      throw new FrameError('too many deliveries to this recipient', { code: 'rate-limited' })
    }
  }
}

export function createCoreHandlers(deps: CoreHandlerDeps): Record<string, CommandHandler> {
  const limitDeliveryTo = createDeliveryLimiter(deps.clock)

  return {
    'scope.request': (async (payload: ScopeRequestPayload, context: CommandContext) => {
      const scopes = required(deps.scopes, 'signalling')
      const routeId = await deps.deriveRouteId(payload.kind, payload.capability)
      const expiresAt = deps.clock.nowMs() + LIMITS.scopeAuthorizationTtlMs
      await scopes.authorize(routeId, context.identity, context.deviceKeyId, expiresAt)
      return { routeId, expiresAt }
    }) as CommandHandler,

    /** Give the authorization up on leaving rather than letting it live out
     *  its lease — the socket it justifies is closed with it. */
    'scope.leave': (async (payload: ScopeLeavePayload, context: CommandContext) => {
      if (!deps.scopes) return {}
      await deps.scopes.release(payload.routeId, context.identity, context.deviceKeyId)
      return {}
    }) as CommandHandler,

    'invite.send': (async (payload: InviteSendPayload, context: CommandContext) => {
      const peers = required(deps.peers, 'invites')
      limitDeliveryTo(payload.to)
      const inviteId = deps.random.uuid()
      const body = { inviteId, from: context.identity, kind: payload.kind, body: payload.body }
      const result = await peers.deliver(
        payload.to,
        [{ kind: 'invite', body }],
        { inviteId, body: JSON.stringify(body) }
      )
      // The recipient refuses rather than evicting an unread invite, so this
      // has to reach the sender instead of being reported as delivered.
      // `cap-exceeded` is the existing code for it — a retry cannot help until
      // the recipient acknowledges something, which is what the client needs
      // to know.
      if (result && result.ok === false) {
        throw new FrameError('recipient mailbox is full', { code: 'cap-exceeded' })
      }
      return { inviteId }
    }) as CommandHandler,

    /** Drop the stored copy once the client confirms it has the invite.
     *  Without this the mailbox only ever grew to its cap and then evicted the
     *  oldest *unread* invite to make room for one already delivered. */
    'invite.ack': ((payload: InviteAckPayload) => {
      deps.storage.mailbox.drop(payload.inviteId)
      return {}
    }) as CommandHandler,

    'ring.send': (async (payload: RingSendPayload, context: CommandContext) => {
      const peers = required(deps.peers, 'ringing')
      limitDeliveryTo(payload.to)
      await peers.deliver(payload.to, [{
        kind: 'ring',
        body: { from: context.identity, roomRoute: payload.roomRoute },
      }])
      return {}
    }) as CommandHandler,

    /**
     * Revoke one of this account's own devices. The account is the socket's
     * identity and never a parameter, so this cannot reach outside it.
     *
     * Until this command existed, revoking a device only dropped a local
     * peer-to-peer grant: the revoked device kept a valid 30-day capability,
     * its server session and its open control socket. "Revoke" has to mean
     * the server stops honouring it.
     */
    'device.revoke': (async (payload: DeviceRevokePayload, context: CommandContext) => {
      const { storage, sockets } = deps
      const target = payload.deviceKeyId
      storage.sessions.setEpoch(target, nextEpoch(storage.sessions.epochFor(target)))
      storage.sessions.deleteForDevice(target)
      for (const socket of sockets.all()) {
        if (socket.deviceKeyId === target) socket.close(4001, 'device revoked')
      }
      // Tell the account's other devices so their lists agree with the server
      // without waiting for a refresh.
      await deps.emit([{
        kind: 'device.revoked',
        body: { deviceKeyId: target, by: context.deviceKeyId },
      }])
      return { deviceKeyId: target }
    }) as CommandHandler,
  }
}

/**
 * Store an inbound mailbox entry for this account.
 *
 * A full mailbox refuses the new entry rather than evicting the oldest. Every
 * row present is unread by construction — `invite.ack` drops an entry the
 * moment the client confirms it — so eviction destroyed unread invites, and
 * because any account may address any other, that was a way to clear somebody's
 * mailbox on demand at roughly five entries a second. Refusing is visible to
 * the sender and costs the recipient nothing.
 */
export function deliverToAccount(
  storage: GatewayStorage,
  clock: Clock,
  mailbox: { inviteId: string; body: string } | undefined
): { ok: true } | { ok: false; code: 'mailbox-full' } {
  if (!mailbox) return { ok: true }
  // A repeat of an entry already held is a retry, not a new occupant.
  if (storage.mailbox.count() >= LIMITS.mailboxEntries && !storage.mailbox.has(mailbox.inviteId)) {
    return { ok: false, code: 'mailbox-full' }
  }
  storage.mailbox.put(mailbox.inviteId, mailbox.body, clock.nowMs())
  return { ok: true }
}

/** Sockets belonging to one account, as the handlers see them. */
export function socketSetOf(all: () => readonly ControlSocket[]): SocketSet {
  return {
    all,
    others: socket => all().filter(other => other !== socket),
  }
}

export type { OpaqueUserId }
