import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { expect, it, vi } from 'vitest'
import { channelIdentity, channelSession } from './channel.test-fixtures.mjs'

const data = text => ({ v: 1, iv: 'a'.repeat(16), ciphertext: btoa(text) })
async function connect(stub, user, sid) {
  const response = await stub.fetch('http://channel/', { headers: { upgrade: 'websocket',
    'x-realtime-uid': user.uid, 'x-realtime-user': user.userId,
    'x-realtime-dk': user.deviceKeyId, 'x-realtime-sid': sid } })
  expect(response.status).toBe(101)
  const ws = response.webSocket, frames = []
  ws.accept(); ws.addEventListener('message', event => { frames.push(JSON.parse(event.data)) })
  return { ws, frames }
}
async function send(client, frame) {
  const messageId = crypto.randomUUID()
  client.ws.send(JSON.stringify({ type: 'event', messageId, ...frame }))
  await vi.waitFor(() => expect(client.frames.some(f => f.type === 'ack' && f.messageId === messageId)).toBe(true))
}

it('replays latest channel state and deletion tombstones after history count and age retention', async () => {
  const stub = env.CONTENT_CHANNELS.getByName('peerly:state-retention-regression')
  const user = channelIdentity('state-retention'), session = await channelSession(user)
  await stub.authorize({ ...user, expiresAt: Date.now() + 60_000,
    authority: { owner: 'owner', version: 1, fingerprint: 'v1', members: [user.principalId] } })
  const writer = await connect(stub, user, session.sid)
  await send(writer, { event: 'channel-sync', state: { key: 'a'.repeat(43), revision: 1, deleted: false }, data: data('original name') })
  await send(writer, { event: 'channel-sync', state: { key: 'a'.repeat(43), revision: 2, deleted: false }, data: data('renamed channel') })
  await send(writer, { event: 'channel-sync', state: { key: 'b'.repeat(43), revision: 3, deleted: true }, data: data('deleted channel') })
  // Stale resync cannot resurrect or overwrite newer state.
  await send(writer, { event: 'channel-sync', state: { key: 'b'.repeat(43), revision: 3, deleted: false }, data: data('resurrected') })
  await runInDurableObject(stub, (_, state) => {
    for (let i = 0; i < 1000; i++) state.storage.sql.exec(`INSERT INTO channel_events
      (message_id,event,data,sender_user_id,sender_dk,created_at) VALUES (?,?,?,?,?,?)`,
      `history-${i}`, 'chat', JSON.stringify(data('history')), user.userId, user.deviceKeyId, Date.now())
  })
  await send(writer, { event: 'chat', data: data('latest message') })
  await runInDurableObject(stub, object => object.pruneHistory(Date.now() + 31 * 86400_000))
  writer.ws.close()
  const reader = await connect(stub, user, session.sid)
  await vi.waitFor(() => expect(reader.frames.some(f => f.type === 'snapshot')).toBe(true))
  const snapshot = reader.frames.find(f => f.type === 'snapshot')
  expect(snapshot.events).toHaveLength(2)
  expect(snapshot.events.map(f => f.data.ciphertext)).toEqual([data('renamed channel').ciphertext, data('deleted channel').ciphertext])
  reader.ws.close()
})
