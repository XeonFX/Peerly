import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { expect, it, vi } from 'vitest'
import { channelIdentity, channelSession } from './channel.test-fixtures.mjs'

const data = text => ({ v: 1, iv: 'a'.repeat(16), ciphertext: btoa(text) })
async function connect(stub, user, session) {
  const response = await stub.fetch('http://channel/', { headers: {
    upgrade: 'websocket', 'x-realtime-uid': user.uid, 'x-realtime-user': user.userId,
    'x-realtime-dk': user.deviceKeyId, 'x-realtime-sid': session.sid,
  } })
  expect(response.status).toBe(101)
  const ws = response.webSocket
  const frames = [], closed = []
  ws.accept()
  ws.addEventListener('message', event => { frames.push(JSON.parse(event.data)) })
  ws.addEventListener('close', event => { closed.push(event.code) })
  return { ws, frames, closed }
}
async function command(client, type, payload) {
  const id = crypto.randomUUID()
  client.ws.send(JSON.stringify({ v: 1, id, type, sentAt: Date.now(), payload }))
  await vi.waitFor(() => expect(client.frames.some(f => f.payload?.for === id)).toBe(true))
  expect(client.frames.find(f => f.payload?.for === id).type).toBe('ack')
}
async function authorize(content, user) {
  await content.authorize({ ...user, expiresAt: Date.now() + 60_000,
    authority: { owner: 'owner', version: 1, fingerprint: 'v1', members: [user.principalId] } })
}

it('revokes content and lobby sockets before acknowledging, and rejects a stale session on reconnect', async () => {
  const good = channelIdentity('revocation-good')
  const bad = { ...good, deviceKeyId: channelIdentity('revocation-bad').deviceKeyId }
  const a = await channelSession(good), b = await channelSession(bad)
  const gateway = env.USER_GATEWAYS.getByName(`peerly:${good.uid}`)
  const control = await connect(gateway, good, a)
  await command(control, 'hello', { version: 1 })
  const revokedControl = await connect(gateway, bad, b)
  await command(revokedControl, 'hello', { version: 1 })
  const content = env.CONTENT_CHANNELS.getByName('peerly:revocation-regression')
  const lobby = env.LOBBY_CHANNELS.getByName('peerly:revocation-lobby')
  await authorize(content, good); await authorize(content, bad)
  const goodContent = await connect(content, good, a), badContent = await connect(content, bad, b)
  const goodLobby = await connect(lobby, good, a), badLobby = await connect(lobby, bad, b)
  await command(control, 'device.revoke', { deviceKeyId: bad.deviceKeyId })
  expect((await gateway.validateSession({ sid: b.sid, dk: bad.deviceKeyId, epoch: b.epoch })).ok).toBe(false)
  await vi.waitFor(() => {
    expect(badContent.closed).toContain(4001)
    expect(badLobby.closed).toContain(4001)
    expect(revokedControl.closed.length).toBeGreaterThan(0)
  })
  expect(revokedControl.frames.some(f => f.type === 'delta' && f.payload.events.some(e => e.kind === 'device.revoked'))).toBe(false)
  for (const [sender, revoked, event] of [[goodContent, badContent, 'chat'], [goodLobby, badLobby, 'pres']]) {
    const id = crypto.randomUUID(), payload = data('after-revoke')
    sender.ws.send(JSON.stringify({ type: 'event', event, messageId: id, data: payload }))
    await vi.waitFor(() => expect(sender.frames.some(f => f.type === 'ack' && f.messageId === id)).toBe(true))
    expect(revoked.frames.some(f => f.data?.ciphertext === payload.ciphertext)).toBe(false)
  }
  for (const stub of [content, lobby]) {
    const response = await stub.fetch('http://channel/', { headers: { upgrade: 'websocket',
      'x-realtime-uid': bad.uid, 'x-realtime-user': bad.userId,
      'x-realtime-dk': bad.deviceKeyId, 'x-realtime-sid': b.sid } })
    expect(response.status).toBe(401)
  }
  control.ws.close(); goodContent.ws.close(); goodLobby.ws.close()
})

it.each(['CONTENT_CHANNELS', 'LOBBY_CHANNELS'])('enforces expiry using the persisted attachment in %s', async binding => {
  const user = channelIdentity(`expiry-${binding}`)
  const session = await channelSession(user)
  const stub = env[binding].getByName(`peerly:expiry-${binding}`)
  if (binding === 'CONTENT_CHANNELS') await authorize(stub, user)
  const client = await connect(stub, user, session)
  await runInDurableObject(stub, async (object, state) => {
    const socket = state.getWebSockets()[0]
    // Persist an elapsed lease, exactly the state recovered after hibernation.
    socket.serializeAttachment({ ...socket.deserializeAttachment(), sessionExpiresAt: Date.now() - 1 })
    await object.webSocketMessage(socket, JSON.stringify({ type: 'event', messageId: 'expired',
      event: binding === 'CONTENT_CHANNELS' ? 'chat' : 'pres', data: data('blocked') }))
  })
  await vi.waitFor(() => expect(client.closed).toContain(4001))
  expect(client.frames.some(f => f.type === 'ack' && f.messageId === 'expired')).toBe(false)
})
