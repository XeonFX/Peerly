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

export function createCoreHandlers(deps: CoreHandlerDeps): Record<string, CommandHandler> {
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
      const inviteId = deps.random.uuid()
      const body = { inviteId, from: context.identity, kind: payload.kind, body: payload.body }
      await peers.deliver(
        payload.to,
        [{ kind: 'invite', body }],
        { inviteId, body: JSON.stringify(body) }
      )
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
 * Store an inbound event stream and mailbox entry for this account, evicting
 * the oldest mailbox row when full.
 */
export function deliverToAccount(
  storage: GatewayStorage,
  clock: Clock,
  mailbox: { inviteId: string; body: string } | undefined
): void {
  if (!mailbox) return
  if (storage.mailbox.count() >= LIMITS.mailboxEntries) {
    const oldest = storage.mailbox.oldestId()
    if (oldest) storage.mailbox.drop(oldest)
  }
  storage.mailbox.put(mailbox.inviteId, mailbox.body, clock.nowMs())
}

/** Sockets belonging to one account, as the handlers see them. */
export function socketSetOf(all: () => readonly ControlSocket[]): SocketSet {
  return {
    all,
    others: socket => all().filter(other => other !== socket),
  }
}

export type { OpaqueUserId }
