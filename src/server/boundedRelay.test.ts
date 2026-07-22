// @ts-nocheck -- exercises the Node-only relay with real ws sockets.
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { createBoundedRelayServer } from '../../packages/core/server/boundedRelay.mjs'

const servers = []
const sockets = []

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function start(options = {}) {
  const relay = createBoundedRelayServer({
    host: '127.0.0.1',
    port: 0,
    clientKey: (_socket, request) => new URL(request.url, 'http://relay').searchParams.get('client') || 'anonymous',
    ...options,
  })
  servers.push(relay)
  await relay.ready
  const address = relay.wss.address()
  if (!address || typeof address === 'string') throw new Error('relay did not bind')
  return { relay, url: `ws://127.0.0.1:${address.port}` }
}

async function connect(url, client) {
  const socket = new WebSocket(`${url}?client=${encodeURIComponent(client)}`)
  sockets.push(socket)
  socket.on('error', () => {})
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

function send(socket, value) {
  socket.send(JSON.stringify(value))
}

function nextMessage(socket) {
  return new Promise(resolve => socket.once('message', data => resolve(JSON.parse(data.toString()))))
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.terminate()
  }
  for (const relay of servers.splice(0)) await relay.close()
})

describe('bounded relay server', () => {
  it('caps subscriptions per socket and never forwards an unsubscribed topic', async () => {
    const { relay, url } = await start({ maxTopicsPerSocket: 1 })
    const subscriber = await connect(url, 'subscriber')
    const publisher = await connect(url, 'publisher')
    send(subscriber, { type: 'subscribe', topic: 'alpha' })
    send(subscriber, { type: 'subscribe', topic: 'beta' })
    await pause(20)

    const alpha = nextMessage(subscriber)
    send(publisher, { type: 'publish', topic: 'alpha', payload: { ok: true } })
    await expect(alpha).resolves.toEqual({ topic: 'alpha', payload: { ok: true } })

    let betaDelivered = false
    subscriber.once('message', () => { betaDelivered = true })
    send(publisher, { type: 'publish', topic: 'beta', payload: { forbidden: true } })
    await pause(30)
    expect(betaDelivered).toBe(false)
    expect(relay.metrics()).toMatchObject({ activeTopics: 1, activeSubscriptions: 1 })
  })

  it('limits simultaneous connections for the same authenticated identity', async () => {
    const { url } = await start({ maxConnectionsPerClient: 1 })
    await connect(url, 'same-user')
    const duplicate = await connect(url, 'same-user')
    const closed = new Promise(resolve => duplicate.once('close', (code, reason) => resolve({ code, reason: reason.toString() })))
    await expect(closed).resolves.toEqual({ code: 1008, reason: 'connection limit' })
  })

  it('keeps per-identity message limits across reconnects', async () => {
    const { relay, url } = await start({
      maxMessagesPerMinute: 100,
      maxMessagesPerClientPerMinute: 2,
    })
    const subscriber = await connect(url, 'subscriber')
    send(subscriber, { type: 'subscribe', topic: 'alpha' })
    await pause(20)

    const received = []
    subscriber.on('message', data => received.push(JSON.parse(data.toString()).payload.sequence))
    const first = await connect(url, 'publisher')
    send(first, { type: 'publish', topic: 'alpha', payload: { sequence: 1 } })
    await pause(20)
    first.terminate()
    await pause(20)

    const reconnected = await connect(url, 'publisher')
    send(reconnected, { type: 'publish', topic: 'alpha', payload: { sequence: 2 } })
    send(reconnected, { type: 'publish', topic: 'alpha', payload: { sequence: 3 } })
    await pause(40)

    expect(received).toEqual([1, 2])
    expect(relay.metrics().rateLimitedTotal).toBe(1)
  })
})
