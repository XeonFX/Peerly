import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  allocateRequest,
  attributeText,
  authenticatedAllocateRequest,
  decodeStun,
  encodeStun,
  errorCode,
  randomTransactionId,
  readChallenge,
  STUN_ATTR,
  STUN_CLASS,
  STUN_METHOD,
  turnRestCredential,
  xorRelayedAddress,
} from './turnAllocate.js'

/**
 * Encoding is where a hand-written protocol goes wrong, and TURN punishes it
 * in the least helpful way available: almost every mistake comes back as a
 * 401, indistinguishable from a wrong shared secret. So these pin the bytes
 * against values taken from the RFCs rather than from this implementation.
 */

/**
 * SHA-1 and MD5 are what RFC 5389 §15.4 specifies for MESSAGE-INTEGRITY and
 * the long-term credential key. These stand in for what a TURN *server* does,
 * so they have to be exactly those algorithms or the test proves nothing.
 */
const hmacSha1 = (key: Uint8Array, message: Uint8Array) =>
  new Uint8Array(createHmac('sha1', key).update(message).digest())

const longTermKey = (username: string, realm: string, password: string) =>
  new Uint8Array(createHash('md5').update(`${username}:${realm}:${password}`).digest())

describe('STUN message framing', () => {
  it('round-trips a request with its attributes', () => {
    const id = randomTransactionId()
    const encoded = encodeStun(STUN_METHOD.allocate, STUN_CLASS.request, id, [
      [STUN_ATTR.username, new TextEncoder().encode('1700000000:probe')],
    ])
    const decoded = decodeStun(encoded)
    expect(decoded?.method).toBe(STUN_METHOD.allocate)
    expect(decoded?.class).toBe(STUN_CLASS.request)
    expect([...(decoded?.transactionId ?? [])]).toEqual([...id])
    expect(attributeText(decoded!, STUN_ATTR.username)).toBe('1700000000:probe')
  })

  it('writes the magic cookie every receiver checks first', () => {
    const encoded = encodeStun(STUN_METHOD.allocate, STUN_CLASS.request, randomTransactionId(), [])
    expect([...encoded.subarray(4, 8)]).toEqual([0x21, 0x12, 0xa4, 0x42])
  })

  it('rejects anything that is not STUN', () => {
    expect(decodeStun(new Uint8Array(4))).toBeNull()
    expect(decodeStun(new Uint8Array(32))).toBeNull()
  })

  it('pads attributes to four bytes without counting the padding', () => {
    // A 5-byte value occupies 8; declaring 8 instead of 5 makes coturn read
    // the padding as part of the realm and reject the credential.
    const encoded = encodeStun(STUN_METHOD.allocate, STUN_CLASS.request, randomTransactionId(), [
      [STUN_ATTR.nonce, new Uint8Array([1, 2, 3, 4, 5])],
    ])
    expect(encoded.length).toBe(20 + 4 + 8)
    expect(new DataView(encoded.buffer).getUint16(2)).toBe(12)
    expect(decodeStun(encoded)?.attributes.get(STUN_ATTR.nonce)?.length).toBe(5)
  })

  it('keeps the first of a repeated attribute', () => {
    const encoded = encodeStun(STUN_METHOD.allocate, STUN_CLASS.request, randomTransactionId(), [
      [STUN_ATTR.realm, new TextEncoder().encode('first')],
      [STUN_ATTR.realm, new TextEncoder().encode('second')],
    ])
    expect(attributeText(decodeStun(encoded)!, STUN_ATTR.realm)).toBe('first')
  })

  it('separates class from method in the type field', () => {
    // They are interleaved rather than adjacent, so a naive encoding produces
    // a message coturn silently ignores.
    for (const klass of [STUN_CLASS.request, STUN_CLASS.success, STUN_CLASS.error]) {
      const encoded = encodeStun(STUN_METHOD.allocate, klass, randomTransactionId(), [])
      const decoded = decodeStun(encoded)!
      expect(decoded.class).toBe(klass)
      expect(decoded.method).toBe(STUN_METHOD.allocate)
    }
  })

  it.each([
    // Message types as written in the RFCs, not as this file computes them.
    // A round-trip through the same interleaving logic agrees with itself
    // whether or not that logic is right; these do not.
    [0x0001, 0x001, STUN_CLASS.request, 'Binding request'],
    [0x0101, 0x001, STUN_CLASS.success, 'Binding success response'],
    [0x0111, 0x001, STUN_CLASS.error, 'Binding error response'],
    [0x0003, 0x003, STUN_CLASS.request, 'Allocate request'],
    [0x0103, 0x003, STUN_CLASS.success, 'Allocate success response'],
    [0x0113, 0x003, STUN_CLASS.error, 'Allocate error response'],
  ])('encodes 0x%s as %s', (wire, method, klass) => {
    const encoded = encodeStun(method, klass, randomTransactionId(), [])
    expect(new DataView(encoded.buffer).getUint16(0)).toBe(wire)
    const decoded = decodeStun(encoded)!
    expect(decoded.method).toBe(method)
    expect(decoded.class).toBe(klass)
  })
})

describe('reading a server response', () => {
  it('reads the numeric error out of an ERROR-CODE attribute', () => {
    // Class digit and number are separate bytes, not a plain uint16.
    const value = new Uint8Array([0, 0, 4, 1, ...new TextEncoder().encode('Unauthorized')])
    const message = decodeStun(
      encodeStun(STUN_METHOD.allocate, STUN_CLASS.error, randomTransactionId(), [
        [STUN_ATTR.errorCode, value],
      ])
    )!
    expect(errorCode(message)).toEqual({ code: 401, reason: 'Unauthorized' })
  })

  it('reads a challenge, and reports its absence', () => {
    const withChallenge = decodeStun(
      encodeStun(STUN_METHOD.allocate, STUN_CLASS.error, randomTransactionId(), [
        [STUN_ATTR.realm, new TextEncoder().encode('peerly.cc')],
        [STUN_ATTR.nonce, new TextEncoder().encode('abc123')],
      ])
    )!
    expect(readChallenge(withChallenge)).toEqual({ realm: 'peerly.cc', nonce: 'abc123' })

    const withoutNonce = decodeStun(
      encodeStun(STUN_METHOD.allocate, STUN_CLASS.error, randomTransactionId(), [
        [STUN_ATTR.realm, new TextEncoder().encode('peerly.cc')],
      ])
    )!
    expect(readChallenge(withoutNonce)).toBeNull()
  })

  it('un-XORs an allocated IPv4 relay address', () => {
    // 203.0.113.9:50000 obscured against the cookie, per RFC 5389 §15.2.
    const port = 50_000 ^ 0x2112
    const address = [203, 0, 113, 9].map((octet, index) => octet ^ [0x21, 0x12, 0xa4, 0x42][index]!)
    const value = new Uint8Array([0, 0x01, port >> 8, port & 0xff, ...address])
    const message = decodeStun(
      encodeStun(STUN_METHOD.allocate, STUN_CLASS.success, randomTransactionId(), [
        [STUN_ATTR.xorRelayedAddress, value],
      ])
    )!
    expect(xorRelayedAddress(message)).toEqual({ address: '203.0.113.9', port: 50_000 })
  })

  it('reports no relayed address when the server sent none', () => {
    const message = decodeStun(
      encodeStun(STUN_METHOD.allocate, STUN_CLASS.success, randomTransactionId(), [])
    )!
    expect(xorRelayedAddress(message)).toBeNull()
  })
})

describe('the REST credential', () => {
  it('matches the scheme the worker mints', () => {
    // Byte-identical or the probe tests a credential coturn would reject
    // while the real one works — a false red that costs a night.
    const secret = 'shared-secret'
    const { username, password } = turnRestCredential(
      secret,
      'probe',
      1_700_000_000_000,
      (key, message) => new Uint8Array(createHmac('sha1', key).update(message).digest())
    )
    expect(username).toBe('1700000000:probe')
    expect(password).toBe(createHmac('sha1', secret).update(username).digest('base64'))
  })
})

describe('the authenticated Allocate', () => {
  const credential = { username: '1700000000:probe', password: 'secret-password' }
  const challenge = { realm: 'peerly.cc', nonce: 'nonce-value' }

  it('carries every attribute coturn requires', () => {
    const request = authenticatedAllocateRequest(
      randomTransactionId(), credential, challenge, hmacSha1, longTermKey
    )
    const decoded = decodeStun(request)!
    expect(attributeText(decoded, STUN_ATTR.username)).toBe(credential.username)
    expect(attributeText(decoded, STUN_ATTR.realm)).toBe(challenge.realm)
    expect(attributeText(decoded, STUN_ATTR.nonce)).toBe(challenge.nonce)
    expect(decoded.attributes.get(STUN_ATTR.requestedTransport)?.[0]).toBe(17)
    expect(decoded.attributes.get(STUN_ATTR.messageIntegrity)?.length).toBe(20)
  })

  it('signs a header length that already counts the integrity attribute', () => {
    // The subtlety that makes this protocol miserable: the HMAC covers a
    // length including 24 bytes that are not there yet. Recomputing it the
    // obvious way disagrees, and coturn answers 401 — identical to a wrong
    // password.
    const id = randomTransactionId()
    const request = authenticatedAllocateRequest(id, credential, challenge, hmacSha1, longTermKey)
    const integrityOffset = request.length - 24
    const signed = request.subarray(0, integrityOffset)

    // What the server does: take everything before the attribute, with the
    // full declared length still in the header.
    const expected = hmacSha1(
      longTermKey(credential.username, challenge.realm, credential.password),
      signed
    )
    expect([...request.subarray(integrityOffset + 4)]).toEqual([...expected])

    const declared = new DataView(request.buffer).getUint16(2)
    expect(declared).toBe(request.length - 20)
  })

  it('changes with the password, so a stale secret cannot pass', () => {
    const id = randomTransactionId()
    const good = authenticatedAllocateRequest(id, credential, challenge, hmacSha1, longTermKey)
    const bad = authenticatedAllocateRequest(
      id, { ...credential, password: 'wrong' }, challenge, hmacSha1, longTermKey
    )
    expect([...good.subarray(good.length - 20)]).not.toEqual([...bad.subarray(bad.length - 20)])
  })
})

describe('the unauthenticated first Allocate', () => {
  it('asks for a UDP relay and offers no credentials', () => {
    const decoded = decodeStun(allocateRequest(randomTransactionId()))!
    expect(decoded.attributes.get(STUN_ATTR.requestedTransport)?.[0]).toBe(17)
    expect(decoded.attributes.has(STUN_ATTR.messageIntegrity)).toBe(false)
    expect(decoded.attributes.has(STUN_ATTR.username)).toBe(false)
  })
})
