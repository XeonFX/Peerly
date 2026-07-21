// @ts-nocheck -- exercises the Node-only relay with real ws sockets.
import { createWsRelayServer } from '@trystero-p2p/ws-relay/server'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { attachCoordinationServer } from '../../server/coordination.mjs'

const openServers = []
const openSockets = []

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.close()
  for (const item of openServers.splice(0)) {
    item.coordination.close()
    await item.relay.close()
  }
})

async function setup() {
  const relay = await createWsRelayServer({ port: 0 })
  await relay.ready
  const coordination = attachCoordinationServer(relay.wss)
  openServers.push({ relay, coordination })
  const address = relay.address()
  if (!address || typeof address === 'string') throw new Error('Relay did not bind TCP')
  return `ws://127.0.0.1:${address.port}`
}

async function client(url) {
  const socket = new WebSocket(url)
  openSockets.push(socket)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

function next(socket, type, predicate = () => true) {
  return new Promise(resolve => {
    const handler = data => {
      const message = JSON.parse(data.toString()).payload
      if (message?.type !== type || !predicate(message)) return
      socket.off('message', handler)
      resolve(message)
    }
    socket.on('message', handler)
  })
}

function send(socket, action, fields = {}) {
  socket.send(JSON.stringify({ v: 1, type: 'coord', action, ...fields }))
}

async function enableSeekAcknowledgements(socket) {
  const ready = next(socket, 'ready')
  send(socket, 'hello', { capabilities: ['seek-ack'] })
  await ready
}

describe('coordination relay extension', () => {
  it('broadcasts presence independently of WebRTC', async () => {
    const url = await setup()
    const a = await client(url)
    const b = await client(url)
    const firstP = next(a, 'presence.snapshot')
    send(a, 'presence.set', { scope: 'workspace', memberId: 'a', data: 'encrypted-a' })
    await firstP
    const snapshotP = next(a, 'presence.snapshot')
    send(b, 'presence.set', { scope: 'workspace', memberId: 'b', data: 'encrypted-b' })
    const snapshot = await snapshotP
    expect(snapshot.members.map(member => member.memberId).sort()).toEqual(['a', 'b'])
  })

  it('atomically matches compatible seekers and reports distinct-user counts', async () => {
    const url = await setup()
    const watcher = await client(url)
    const a = await client(url)
    const b = await client(url)
    send(watcher, 'seek.watch', { pool: 'random' })
    send(a, 'seek.set', { pool: 'random', memberId: 'a', tags: ['music'], data: 'a' })
    const matchA = next(a, 'seek.match')
    const matchB = next(b, 'seek.match')
    send(b, 'seek.set', { pool: 'random', memberId: 'b', tags: ['music'], data: 'b' })
    const [left, right] = await Promise.all([matchA, matchB])
    expect(left.roomCode).toBe(right.roomCode)
    expect(left.initiator).not.toBe(right.initiator)
    const statsP = next(watcher, 'seek.stats', message => message.total === 0)
    send(watcher, 'seek.watch', { pool: 'random' })
    await expect(statsP).resolves.toMatchObject({ total: 0, tags: {} })
  })

  it('commits a v2 match only after both seekers acknowledge the proposal', async () => {
    const url = await setup()
    const a = await client(url)
    const b = await client(url)
    await Promise.all([enableSeekAcknowledgements(a), enableSeekAcknowledgements(b)])

    send(a, 'seek.set', { pool: 'random', memberId: 'a', tags: ['music'], data: 'a' })
    const proposalA = next(a, 'seek.proposal')
    const proposalB = next(b, 'seek.proposal')
    send(b, 'seek.set', { pool: 'random', memberId: 'b', tags: ['music'], data: 'b' })
    const [leftProposal, rightProposal] = await Promise.all([proposalA, proposalB])
    expect(leftProposal.matchId).toBe(rightProposal.matchId)

    const committed = []
    const collect = data => {
      const message = JSON.parse(data.toString()).payload
      if (message?.type === 'seek.match') committed.push(message)
    }
    a.on('message', collect)
    b.on('message', collect)
    send(a, 'seek.ack', { pool: 'random', matchId: leftProposal.matchId })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(committed).toHaveLength(0)

    const matchA = next(a, 'seek.match')
    const matchB = next(b, 'seek.match')
    send(b, 'seek.ack', { pool: 'random', matchId: leftProposal.matchId })
    const [left, right] = await Promise.all([matchA, matchB])
    expect(left.roomCode).toBe(right.roomCode)
    expect(left.initiator).not.toBe(right.initiator)
  })

  it('returns the live seeker to the pool when its proposed partner disconnects', async () => {
    const url = await setup()
    const watcher = await client(url)
    const a = await client(url)
    const b = await client(url)
    await Promise.all([enableSeekAcknowledgements(a), enableSeekAcknowledgements(b)])
    send(watcher, 'seek.watch', { pool: 'random' })
    send(a, 'seek.set', { pool: 'random', memberId: 'a', tags: ['music'], data: 'a' })
    const proposalA = next(a, 'seek.proposal')
    const proposalB = next(b, 'seek.proposal')
    send(b, 'seek.set', { pool: 'random', memberId: 'b', tags: ['music'], data: 'b' })
    await Promise.all([proposalA, proposalB])

    const restored = next(watcher, 'seek.stats', message => message.total === 1)
    b.close()
    await expect(restored).resolves.toMatchObject({ total: 1, tags: { music: 1 } })
  })

  it('does not match users excluded by either seeker', async () => {
    const url = await setup()
    const a = await client(url)
    const b = await client(url)
    const watcher = await client(url)
    send(watcher, 'seek.watch', { pool: 'random' })
    send(a, 'seek.set', {
      pool: 'random', memberId: 'a', tags: ['music'], data: 'a', excluded: ['b'],
    })
    send(b, 'seek.set', { pool: 'random', memberId: 'b', tags: ['music'], data: 'b' })
    const statsP = next(watcher, 'seek.stats', message => message.total === 2)
    send(watcher, 'seek.watch', { pool: 'random' })
    await expect(statsP).resolves.toMatchObject({ total: 2, tags: { music: 2 } })
  })
})
