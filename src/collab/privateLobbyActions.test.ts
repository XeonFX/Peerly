import { describe, expect, it, vi } from 'vitest'
import type { RelayChannelAction } from '@peerly/core'
import { createPrivateLobbyActions } from './privateLobbyActions'

function endpoint() {
  const actions = new Map<string, RelayChannelAction<unknown>>()
  const frames: { event: string; value: unknown; target?: string }[] = []
  const room = {
    makeAction<T>(event: string): RelayChannelAction<T> {
      const action: RelayChannelAction<T> = { onMessage: null,
        async send(value, options) { frames.push({ event, value, target: options?.target }) } }
      actions.set(event, action as RelayChannelAction<unknown>)
      return action
    },
  }
  return { actions, frames, sealed: createPrivateLobbyActions(room) }
}

async function pair() {
  const alice = endpoint()
  const bob = endpoint()
  await alice.sealed.rememberVerifiedPeer('bob', 'bob-device', await bob.sealed.publicKey())
  await bob.sealed.rememberVerifiedPeer('alice', 'alice-device', await alice.sealed.publicKey())
  return { alice, bob }
}

describe('private lobby invitation delivery', () => {
  it.each(['finv', 'finvr', 'winv', 'dmring'])('encrypts %s to the verified recipient', async event => {
    const { alice, bob } = await pair()
    const send = alice.sealed.makeAction(event)
    const receive = bob.sealed.makeAction(event)
    receive.onMessage = vi.fn()
    const value = { dmSecret: 'secret-dm-root', invite: { workspaceId: 'secret-workspace-root' } }
    await send.send(value, { target: 'bob' })
    expect(JSON.stringify(alice.frames)).not.toContain('secret-dm-root')
    expect(JSON.stringify(alice.frames)).not.toContain('secret-workspace-root')
    bob.actions.get(event)!.onMessage!(alice.frames[0].value, { peerId: 'alice' })
    await vi.waitFor(() => expect(receive.onMessage).toHaveBeenCalledWith(value, { peerId: 'alice' }))
  })

  it('rejects plaintext, unknown sender keys, wrong recipients and cross-event substitution', async () => {
    const { alice, bob } = await pair()
    const eve = endpoint()
    const receive = bob.sealed.makeAction('winv')
    receive.onMessage = vi.fn()
    await alice.sealed.makeAction('finv').send({ dmSecret: 'secret' }, { target: 'bob' })
    const envelope = alice.frames[0].value as Record<string, unknown>
    const deliver = (value: unknown) => bob.actions.get('winv')!.onMessage!(value, { peerId: 'alice' })
    deliver({ dmSecret: 'plaintext' })
    deliver({ ...envelope, senderKey: await eve.sealed.publicKey() })
    deliver({ ...envelope, recipientKey: await eve.sealed.publicKey() })
    deliver(envelope)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(receive.onMessage).not.toHaveBeenCalled()
  })

  it('does not send any secret before verifying the recipient key or after peer departure', async () => {
    const alice = endpoint()
    const send = alice.sealed.makeAction('finv')
    await send.send({ dmSecret: 'secret' }, { target: 'unverified' })
    await send.send({ dmSecret: 'secret' })
    expect(await alice.sealed.rememberVerifiedPeer('bob', 'device', 'malformed')).toBe(false)
    const bob = endpoint()
    await alice.sealed.rememberVerifiedPeer('bob', 'device', await bob.sealed.publicKey())
    alice.sealed.forgetPeer('bob')
    await send.send({ dmSecret: 'secret' }, { target: 'bob' })
    expect(alice.frames).toHaveLength(0)
  })

  it('separately seals an invitation for each verified device of one account', async () => {
    const { alice, bob } = await pair()
    const secondBob = endpoint()
    await alice.sealed.rememberVerifiedPeer('bob', 'bob-second-device', await secondBob.sealed.publicKey())
    await secondBob.sealed.rememberVerifiedPeer('alice', 'alice-device', await alice.sealed.publicKey())
    const receivers = [bob, secondBob].map(endpoint => {
      const action = endpoint.sealed.makeAction('winv'); action.onMessage = vi.fn(); return action
    })
    await alice.sealed.makeAction('winv').send({ secret: 'shared-only-with-bob' }, { target: 'bob' })
    expect(alice.frames).toHaveLength(2)
    for (const frame of alice.frames) {
      for (const endpoint of [bob, secondBob]) endpoint.actions.get('winv')!.onMessage!(frame.value, { peerId: 'alice' })
    }
    await vi.waitFor(() => { for (const receiver of receivers) expect(receiver.onMessage).toHaveBeenCalledTimes(1) })
  })
})
