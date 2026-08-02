import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoreHandlers, deliverToAccount, socketSetOf } from './coreHandlers.js'
import { createMemoryGatewayStorage } from '../adapters/memory/gatewayStorage.js'
import { LIMITS } from '../protocol/limits.js'
import { FrameError } from '../protocol/frames.js'
import type { GatewayStorage, ControlSocket } from '../ports/index.js'
import type { DeviceKeyId, OpaqueUserId } from '../protocol/ids.js'
import type { CommandContext } from './gatewayService.js'

const uid = (value: string) => value as OpaqueUserId
const dk = (value: string) => value as DeviceKeyId

function socket(id: string, device: string): ControlSocket & { closed: number[] } {
  const closed: number[] = []
  return {
    id,
    deviceKeyId: dk(device),
    negotiated: () => true,
    markNegotiated: () => {},
    send: () => {},
    close: code => { closed.push(code) },
    closed,
  }
}

describe('core command handlers', () => {
  let storage: GatewayStorage
  let sockets: ReturnType<typeof socket>[]
  let scopes: { authorize: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }
  let peers: { deliver: ReturnType<typeof vi.fn> }
  let emitted: { kind: string; body: Record<string, unknown> }[]

  const context = (device = 'device-a'): CommandContext => ({
    identity: uid('account-1'),
    deviceKeyId: dk(device),
    socket: sockets[0],
  })

  const build = (overrides: Partial<Parameters<typeof createCoreHandlers>[0]> = {}) =>
    createCoreHandlers({
      storage,
      clock: { nowMs: () => 1_000 },
      random: { uuid: () => 'invite-uuid' },
      sockets: socketSetOf(() => sockets),
      deriveRouteId: async (kind, capability) => `route-${kind}-${capability}`,
      scopes,
      peers,
      emit: async events => { emitted.push(...events) },
      ...overrides,
    })

  beforeEach(() => {
    storage = createMemoryGatewayStorage()
    storage.identity.remember(uid('account-1'))
    sockets = [socket('s1', 'device-a'), socket('s2', 'device-b')]
    scopes = { authorize: vi.fn(async () => {}), release: vi.fn(async () => {}) }
    peers = { deliver: vi.fn(async () => {}) }
    emitted = []
  })

  describe('scope.request', () => {
    it('authorizes the derived route and returns it with its expiry', async () => {
      const result = await build()['scope.request'](
        { kind: 'room', capability: 'cap-1' } as never, context()
      )
      expect(result).toEqual({ routeId: 'route-room-cap-1', expiresAt: 1_000 + LIMITS.scopeAuthorizationTtlMs })
      expect(scopes.authorize).toHaveBeenCalledWith(
        'route-room-cap-1', 'account-1', 'device-a', 1_000 + LIMITS.scopeAuthorizationTtlMs
      )
    })

    it('reports not-found on a deployment without signalling bound', async () => {
      await expect(build({ scopes: null })['scope.request'](
        { kind: 'room', capability: 'cap-1' } as never, context()
      )).rejects.toBeInstanceOf(FrameError)
    })
  })

  describe('scope.leave', () => {
    it('releases the authorization for this device', async () => {
      await build()['scope.leave']({ routeId: 'route-1' } as never, context())
      expect(scopes.release).toHaveBeenCalledWith('route-1', 'account-1', 'device-a')
    })

    it('is a no-op rather than an error when signalling is unbound', async () => {
      await expect(build({ scopes: null })['scope.leave'](
        { routeId: 'route-1' } as never, context()
      )).resolves.toEqual({})
    })
  })

  describe('invite.send', () => {
    it('delivers to the target with a mailbox copy and returns the invite id', async () => {
      const result = await build()['invite.send'](
        { to: 'account-2', kind: 'friend', body: { note: 'hi' } } as never, context()
      )
      expect(result).toEqual({ inviteId: 'invite-uuid' })
      const [to, events, mailbox] = peers.deliver.mock.calls[0]
      expect(to).toBe('account-2')
      expect(events[0]).toMatchObject({ kind: 'invite', body: { from: 'account-1', kind: 'friend' } })
      expect(mailbox.inviteId).toBe('invite-uuid')
    })
  })

  describe('invite.ack', () => {
    it('drops the stored copy so the cap stops evicting unread invites', () => {
      storage.mailbox.put('invite-1', '{}', 0)
      build()['invite.ack']({ inviteId: 'invite-1' } as never, context())
      expect(storage.mailbox.count()).toBe(0)
    })
  })

  describe('ring.send', () => {
    it('delivers a ring naming the caller, not the callee', async () => {
      await build()['ring.send']({ to: 'account-2', roomRoute: 'route-9' } as never, context())
      const [, events] = peers.deliver.mock.calls[0]
      expect(events[0]).toEqual({ kind: 'ring', body: { from: 'account-1', roomRoute: 'route-9' } })
    })
  })

  /**
   * Both delivering commands name their target, and the command budget is a
   * per-socket allowance — so all of it could be aimed at one person. That was
   * enough to fill a stranger's mailbox in seconds and to bill this account for
   * every write, from any account that had ever learned the opaque id.
   */
  describe('per-recipient delivery limit', () => {
    it('stops one socket aiming its whole budget at a single recipient', async () => {
      const handlers = build()
      const ring = () => handlers['ring.send']({ to: 'victim', roomRoute: 'r' } as never, context())

      for (let sent = 0; sent < LIMITS.deliveriesBurstPerRecipient; sent += 1) await ring()
      await expect(ring()).rejects.toThrow(/deliveries/)
      expect(peers.deliver).toHaveBeenCalledTimes(LIMITS.deliveriesBurstPerRecipient)
    })

    it('counts each recipient separately, so one target cannot mute the rest', async () => {
      const handlers = build()
      for (let sent = 0; sent < LIMITS.deliveriesBurstPerRecipient; sent += 1) {
        await handlers['ring.send']({ to: 'victim', roomRoute: 'r' } as never, context())
      }
      await expect(
        handlers['ring.send']({ to: 'someone-else', roomRoute: 'r' } as never, context())
      ).resolves.toEqual({})
    })

    it('reports a refused mailbox to the sender instead of acknowledging it', async () => {
      peers.deliver = vi.fn(async () => ({ ok: false, code: 'mailbox-full' }))
      await expect(
        build({ peers })['invite.send']({ to: 'full', kind: 'k', body: {} } as never, context())
      ).rejects.toThrow(/mailbox/)
    })
  })

  describe('device.revoke', () => {
    beforeEach(() => {
      storage.sessions.insert({
        sid: 's-b', deviceKeyId: dk('device-b'), epoch: 0, createdAtMs: 0, expiresAtMs: 100_000,
      })
      storage.sessions.insert({
        sid: 's-a', deviceKeyId: dk('device-a'), epoch: 0, createdAtMs: 0, expiresAtMs: 100_000,
      })
    })

    it('bumps the epoch so capabilities already issued stop validating', async () => {
      await build()['device.revoke']({ deviceKeyId: dk('device-b') } as never, context())
      expect(storage.sessions.epochFor(dk('device-b'))).toBe(1)
    })

    it('deletes the revoked device sessions and leaves the others alone', async () => {
      await build()['device.revoke']({ deviceKeyId: dk('device-b') } as never, context())
      expect(storage.sessions.all().map(session => session.sid)).toEqual(['s-a'])
    })

    it('closes the revoked device sockets and only those', async () => {
      await build()['device.revoke']({ deviceKeyId: dk('device-b') } as never, context())
      expect(sockets[1].closed).toEqual([4001])
      expect(sockets[0].closed).toEqual([])
    })

    it('tells the account other devices who revoked what', async () => {
      await build()['device.revoke']({ deviceKeyId: dk('device-b') } as never, context())
      expect(emitted).toEqual([
        { kind: 'device.revoked', body: { deviceKeyId: 'device-b', by: 'device-a' } },
      ])
    })
  })

  describe('mailbox delivery', () => {
    const clock = { nowMs: () => 5 }

    it('stores an inbound invite', () => {
      deliverToAccount(storage, clock, { inviteId: 'i1', body: '{}' })
      expect(storage.mailbox.count()).toBe(1)
    })

    /**
     * Every entry present is unread — `invite.ack` drops one the moment the
     * client confirms it — so evicting to make room destroyed an unread invite.
     * Any account may address any other, which made that a way to clear
     * somebody's mailbox on demand.
     */
    it('refuses a new entry once full rather than evicting an unread one', () => {
      for (let index = 0; index < LIMITS.mailboxEntries; index += 1) {
        storage.mailbox.put(`i${index}`, '{}', index)
      }
      const result = deliverToAccount(storage, clock, { inviteId: 'newest', body: '{}' })

      expect(result).toEqual({ ok: false, code: 'mailbox-full' })
      expect(storage.mailbox.count()).toBe(LIMITS.mailboxEntries)
      expect(storage.mailbox.oldestId()).toBe('i0')
    })

    it('still accepts a redelivery of an entry it already holds', () => {
      for (let index = 0; index < LIMITS.mailboxEntries; index += 1) {
        storage.mailbox.put(`i${index}`, '{}', index)
      }
      // A retried delivery is not a new occupant, so the cap must not reject it.
      expect(deliverToAccount(storage, clock, { inviteId: 'i0', body: '{"v":2}' }))
        .toEqual({ ok: true })
      expect(storage.mailbox.count()).toBe(LIMITS.mailboxEntries)
    })

    it('does nothing when there is no mailbox copy to store', () => {
      deliverToAccount(storage, clock, undefined)
      expect(storage.mailbox.count()).toBe(0)
    })
  })

  describe('socket set', () => {
    it('excludes the given socket, which is what a closing socket needs', () => {
      const set = socketSetOf(() => sockets)
      expect(set.others(sockets[0])).toEqual([sockets[1]])
      expect(set.all()).toHaveLength(2)
    })
  })
})
