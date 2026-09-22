import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { channelIdentity, channelSession } from './channel.test-fixtures.mjs'
import { LIMITS } from './index.mjs'

it('evicting a session closes its content and lobby sockets', async () => {
  const victim = channelIdentity('review-eviction')
  const session = await channelSession(victim)
  const gateway = env.USER_GATEWAYS.getByName(`peerly:${victim.uid}`)
  const sockets = []
  for (const binding of ['CONTENT_CHANNELS', 'LOBBY_CHANNELS']) {
    const stub = env[binding].getByName(`peerly:review-eviction-${binding}`)
    if (binding === 'CONTENT_CHANNELS') await stub.authorize({ ...victim, expiresAt: Date.now() + 60000,
      authority: { owner: 'owner', version: 1, fingerprint: 'v1', members: [victim.principalId] } })
    const response = await stub.fetch('http://channel/', { headers: { upgrade: 'websocket',
      'x-realtime-uid': victim.uid, 'x-realtime-user': victim.userId,
      'x-realtime-dk': victim.deviceKeyId, 'x-realtime-sid': session.sid } })
    expect(response.status).toBe(101)
    const ws = response.webSocket, frames = [], closed = []
    ws.accept(); ws.addEventListener('message', e => { frames.push(JSON.parse(e.data)) })
    ws.addEventListener('close', e => { closed.push(e.code) })
    sockets.push({ ws, frames, binding, closed })
  }
  for (let i = 0; i < LIMITS.devicesPerAccount; i++) {
    await channelSession({ ...victim, deviceKeyId: channelIdentity(`replacement-${i}`).deviceKeyId })
  }
  expect((await gateway.validateSession({ sid: session.sid, dk: victim.deviceKeyId, epoch: session.epoch })).ok).toBe(false)
  for (const { closed } of sockets) await vi.waitFor(() => expect(closed).toContain(4001))
})
