#!/usr/bin/env node
import { createConnection } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { createSocket } from 'node:dgram'
import { createHash, createHmac } from 'node:crypto'
import {
  allocateRequest,
  authenticatedAllocateRequest,
  decodeStun,
  errorCode,
  randomTransactionId,
  readChallenge,
  STUN_CLASS,
  turnRestCredential,
  xorRelayedAddress,
} from '../dist/turnAllocate.js'

/**
 * Ask the real coturn for a real allocation, from a terminal or a cron.
 *
 * This is the only check that catches the class of failure that prompted the
 * Durable Objects rewrite. Both browser harnesses run two contexts on one
 * host, where peers connect over host candidates and never touch a relay — so
 * a wrong TURN URL, a rotated secret or a coturn that stopped answering is
 * invisible to every other test we have, right up until two real users on
 * different networks cannot connect.
 *
 *   TURN_AUTH_SECRET=... node packages/core/scripts/turn-smoke.mjs \
 *     turn:turn.peerly.cc:3478 turns:turn.peerly.cc:5349
 *
 * URLs may also come from TURN_URLS. Exits non-zero if any of them fails, so
 * a scheduler needs no output parsing.
 *
 * Each transport is tried independently and reported separately: UDP being
 * blocked on the runner's network while TLS works is a normal, healthy
 * result, and collapsing them into one verdict would hide the case that
 * matters — every transport failing.
 */

const TIMEOUT_MS = Number(process.env.TURN_PROBE_TIMEOUT_MS) || 8_000
const CREDENTIAL_TTL_MS = 5 * 60_000

const hmacSha1Text = (key, message) =>
  new Uint8Array(createHmac('sha1', key).update(message).digest())
const hmacSha1Key = (key, message) =>
  new Uint8Array(createHmac('sha1', key).update(message).digest())
const longTermKey = (username, realm, password) =>
  new Uint8Array(createHash('md5').update(`${username}:${realm}:${password}`).digest())

/** `turns:host:5349?transport=tcp` → the pieces the socket layer needs. */
function parseTurnUrl(raw) {
  const match = /^(turns?):([^:?]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/i.exec(raw.trim())
  if (!match) throw new Error(`unrecognised TURN URL: ${raw}`)
  const [, scheme, host, port, transport] = match
  const secure = scheme.toLowerCase() === 'turns'
  return {
    raw: raw.trim(),
    host,
    port: Number(port) || (secure ? 5349 : 3478),
    // `turns` is always TLS over TCP. Plain `turn` defaults to UDP unless the
    // URL says otherwise.
    kind: secure ? 'tls' : (transport ?? 'udp').toLowerCase(),
  }
}

/**
 * One connection, reused for the challenge and the authenticated retry.
 *
 * Not an optimisation. coturn binds a nonce to the connection it issued it
 * on, so a second socket — even the same host and port, just a different
 * source port — gets `438 Wrong nonce`. Doing it the obvious way looks
 * exactly like a broken client and reports nothing useful about the server.
 */
function openUdp(target) {
  const socket = createSocket('udp4')
  const pending = []
  socket.on('message', data => pending.shift()?.resolve(new Uint8Array(data)))
  socket.on('error', error => {
    while (pending.length) pending.shift().reject(error)
  })
  return {
    send(payload) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = pending.findIndex(entry => entry.timer === timer)
          if (index >= 0) pending.splice(index, 1)
          reject(new Error('no response within timeout'))
        }, TIMEOUT_MS)
        pending.push({
          timer,
          resolve: value => { clearTimeout(timer); resolve(value) },
          reject: error => { clearTimeout(timer); reject(error) },
        })
        socket.send(payload, target.port, target.host, error => {
          if (error) pending.pop()?.reject(error)
        })
      })
    },
    close: () => socket.close(() => {}),
  }
}

function openStream(target) {
  const socket = target.kind === 'tls'
    ? tlsConnect({
        host: target.host,
        port: target.port,
        servername: target.host,
        // The point of the check is whether a browser would accept this
        // server, and a browser will not accept a bad certificate.
        rejectUnauthorized: true,
      })
    : createConnection({ host: target.host, port: target.port })

  let buffer = Buffer.alloc(0)
  let waiter = null
  let failure = null

  const settle = () => {
    if (!waiter) return
    // TCP is a stream: a STUN message may arrive split, or with the next one
    // behind it. Wait for the declared length before decoding.
    if (buffer.length < 20) return
    const declared = buffer.readUInt16BE(2)
    if (buffer.length < 20 + declared) return
    const message = new Uint8Array(buffer.subarray(0, 20 + declared))
    buffer = buffer.subarray(20 + declared)
    const resolve = waiter.resolve
    waiter = null
    resolve(message)
  }

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    settle()
  })
  const fail = error => {
    failure = error
    waiter?.reject(error)
    waiter = null
  }
  socket.on('error', fail)
  socket.on('close', () => fail(new Error('connection closed before a response')))

  const connected = new Promise((resolve, reject) => {
    socket.once(target.kind === 'tls' ? 'secureConnect' : 'connect', resolve)
    socket.once('error', reject)
  })

  return {
    async send(payload) {
      await connected
      if (failure) throw failure
      socket.write(payload)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null
          reject(new Error('no response within timeout'))
        }, TIMEOUT_MS)
        waiter = {
          resolve: value => { clearTimeout(timer); resolve(value) },
          reject: error => { clearTimeout(timer); reject(error) },
        }
        settle()
      })
    },
    close: () => socket.destroy(),
  }
}

function openConnection(target) {
  return target.kind === 'udp' ? openUdp(target) : openStream(target)
}

async function probe(target, secret) {
  const connection = openConnection(target)
  try {
    return await allocate(connection, secret)
  } finally {
    connection.close()
  }
}

async function allocate(connection, secret) {
  const first = decodeStun(await connection.send(Buffer.from(allocateRequest(randomTransactionId()))))
  if (!first) throw new Error('reply was not a STUN message')

  // The 401 is the expected happy path: it is how the realm and nonce arrive.
  const challenge = readChallenge(first)
  if (!challenge) {
    const error = errorCode(first)
    throw new Error(
      error
        ? `expected an auth challenge, got ${error.code} ${error.reason}`
        : 'expected an auth challenge with a realm and nonce'
    )
  }

  const credential = turnRestCredential(
    secret, 'turn-smoke', Date.now() + CREDENTIAL_TTL_MS, hmacSha1Text
  )
  const authed = decodeStun(await connection.send(
    Buffer.from(authenticatedAllocateRequest(
      randomTransactionId(), credential, challenge, hmacSha1Key, longTermKey
    ))
  ))
  if (!authed) throw new Error('authenticated reply was not a STUN message')

  if (authed.class === STUN_CLASS.error) {
    const error = errorCode(authed)
    const code = error?.code
    // 401 after a valid challenge means the shared secret does not match the
    // one coturn was started with — by far the most likely real failure, and
    // worth naming rather than printing a number.
    if (code === 401) throw new Error('401 unauthorized — TURN_AUTH_SECRET does not match coturn')
    throw new Error(`allocation refused: ${code ?? '?'} ${error?.reason ?? ''}`.trim())
  }

  const relayed = xorRelayedAddress(authed)
  if (!relayed) throw new Error('allocation succeeded but carried no relayed address')
  return `${relayed.address}:${relayed.port}`
}

const secret = process.env.TURN_AUTH_SECRET
if (!secret) {
  console.error('turn-smoke: TURN_AUTH_SECRET is required (the value coturn was started with).')
  process.exit(2)
}

const urls = (process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : (process.env.TURN_URLS ?? '').split(',')
).map(value => value.trim()).filter(Boolean)

if (urls.length === 0) {
  console.error('turn-smoke: pass TURN URLs as arguments, or set TURN_URLS.')
  process.exit(2)
}

let failed = 0
for (const url of urls) {
  let target
  try {
    target = parseTurnUrl(url)
  } catch (error) {
    console.error(`✗ ${url} — ${error.message}`)
    failed++
    continue
  }
  const started = Date.now()
  try {
    const relayed = await probe(target, secret)
    console.log(`✓ ${target.raw} [${target.kind}] allocated ${relayed} in ${Date.now() - started}ms`)
  } catch (error) {
    console.error(`✗ ${target.raw} [${target.kind}] — ${error.message}`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\nturn-smoke: ${failed} of ${urls.length} TURN endpoint(s) failed.`)
  process.exit(1)
}
console.log(`\nturn-smoke: all ${urls.length} TURN endpoint(s) allocated.`)
