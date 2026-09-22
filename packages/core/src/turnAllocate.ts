/**
 * A TURN Allocate request, by hand.
 *
 * The browser probe (`probeTurnCapability`) needs WebRTC, a signed-in session
 * and a page. That makes it useless as the scheduled check this deployment
 * actually needs: a bad TURN URL, an expired secret or a coturn that stopped
 * answering are invisible to every browser test, because two contexts on one
 * host connect over host candidates and never reach a relay.
 *
 * So this speaks TURN directly. It mints its own REST credential from the
 * shared secret — the same scheme the worker uses — and asks coturn for an
 * allocation. A success proves DNS, transport reachability, the shared secret,
 * and allocation, per transport, with no browser and no second user.
 *
 * Everything here is pure: bytes in, bytes out. The sockets live in the
 * script that drives it, because UDP, TCP and TLS are Node's business and this
 * package also runs in a browser and a Worker.
 *
 * References: STUN is RFC 5389, TURN is RFC 5766.
 */

const MAGIC_COOKIE = 0x2112a442

export const STUN_METHOD = {
  allocate: 0x003,
} as const

export const STUN_CLASS = {
  request: 0x00,
  success: 0x02,
  error: 0x03,
} as const

export const STUN_ATTR = {
  username: 0x0006,
  messageIntegrity: 0x0008,
  errorCode: 0x0009,
  realm: 0x0014,
  nonce: 0x0015,
  xorRelayedAddress: 0x0016,
  requestedTransport: 0x0019,
  software: 0x8022,
} as const

/** TURN only allocates UDP relays in practice; the value is IANA protocol 17. */
const TRANSPORT_UDP = 17

export type StunAttributes = ReadonlyArray<readonly [type: number, value: Uint8Array]>

export type StunMessage = {
  method: number
  class: number
  transactionId: Uint8Array
  attributes: Map<number, Uint8Array>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function messageType(method: number, klass: number): number {
  // The class bits are scattered through the type field (RFC 5389 §6): C1 is
  // bit 8 and C0 is bit 4, with the method bits filling the gaps around them.
  return (
    ((method & 0x0f80) << 2) |
    ((method & 0x0070) << 1) |
    (method & 0x000f) |
    ((klass & 0x02) << 7) |
    ((klass & 0x01) << 4)
  )
}

function classOf(type: number): number {
  return ((type >> 7) & 0x02) | ((type >> 4) & 0x01)
}

function methodOf(type: number): number {
  return ((type >> 2) & 0x0f80) | ((type >> 1) & 0x0070) | (type & 0x000f)
}

/** Attributes are padded to a 4-byte boundary; the padding is not counted. */
function paddedLength(length: number): number {
  return length + ((4 - (length % 4)) % 4)
}

export function randomTransactionId(): Uint8Array {
  const id = new Uint8Array(12)
  crypto.getRandomValues(id)
  return id
}

/**
 * Encodes a message. `extraLength` inflates the declared header length without
 * adding bytes — MESSAGE-INTEGRITY is computed over a header that already
 * counts the integrity attribute that does not exist yet (RFC 5389 §15.4).
 */
export function encodeStun(
  method: number,
  klass: number,
  transactionId: Uint8Array,
  attributes: StunAttributes,
  extraLength = 0
): Uint8Array {
  let body = 0
  for (const [, value] of attributes) body += 4 + paddedLength(value.length)

  const out = new Uint8Array(20 + body)
  const view = new DataView(out.buffer)
  view.setUint16(0, messageType(method, klass))
  view.setUint16(2, body + extraLength)
  view.setUint32(4, MAGIC_COOKIE)
  out.set(transactionId, 8)

  let offset = 20
  for (const [type, value] of attributes) {
    view.setUint16(offset, type)
    view.setUint16(offset + 2, value.length)
    out.set(value, offset + 4)
    offset += 4 + paddedLength(value.length)
  }
  return out
}

/** Returns null for anything that is not a well-formed STUN message. */
export function decodeStun(data: Uint8Array): StunMessage | null {
  if (data.length < 20) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (view.getUint32(4) !== MAGIC_COOKIE) return null
  const length = view.getUint16(2)
  if (data.length < 20 + length) return null

  const attributes = new Map<number, Uint8Array>()
  let offset = 20
  const end = 20 + length
  while (offset + 4 <= end) {
    const type = view.getUint16(offset)
    const size = view.getUint16(offset + 2)
    if (offset + 4 + size > end) break
    // First occurrence wins, as required for repeated attributes.
    if (!attributes.has(type)) attributes.set(type, data.subarray(offset + 4, offset + 4 + size))
    offset += 4 + paddedLength(size)
  }

  const type = view.getUint16(0)
  return {
    method: methodOf(type),
    class: classOf(type),
    transactionId: data.subarray(8, 20),
    attributes,
  }
}

export function attributeText(message: StunMessage, type: number): string | undefined {
  const value = message.attributes.get(type)
  return value ? decoder.decode(value) : undefined
}

/** The numeric STUN error, e.g. 401 unauthorized or 441 wrong credentials. */
export function errorCode(message: StunMessage): { code: number; reason: string } | null {
  const value = message.attributes.get(STUN_ATTR.errorCode)
  if (!value || value.length < 4) return null
  // Two reserved bytes, then a class digit and a number 0–99.
  const code = (value[2]! & 0x07) * 100 + value[3]!
  return { code, reason: decoder.decode(value.subarray(4)) }
}

/**
 * The relayed address coturn allocated, XOR-obscured against the cookie and
 * transaction id. Its presence is the actual proof of success.
 */
export function xorRelayedAddress(message: StunMessage): { address: string; port: number } | null {
  const value = message.attributes.get(STUN_ATTR.xorRelayedAddress)
  if (!value || value.length < 8) return null
  const family = value[1]
  const port = ((value[2]! << 8) | value[3]!) ^ (MAGIC_COOKIE >>> 16)
  if (family === 0x01) {
    const cookie = [0x21, 0x12, 0xa4, 0x42]
    const octets = [0, 1, 2, 3].map(index => value[4 + index]! ^ cookie[index]!)
    return { address: octets.join('.'), port }
  }
  // IPv6 is xor'd against the cookie followed by the transaction id.
  const mask = [0x21, 0x12, 0xa4, 0x42, ...message.transactionId]
  const bytes = [...value.subarray(4, 20)].map((byte, index) => byte ^ mask[index]!)
  const groups: string[] = []
  for (let index = 0; index < 16; index += 2) {
    groups.push(((bytes[index]! << 8) | bytes[index + 1]!).toString(16))
  }
  return { address: groups.join(':'), port }
}

/**
 * A coturn REST credential: the username carries its own expiry, and the
 * password is derived from the shared secret, so no per-user state exists
 * anywhere. Must stay byte-identical to the worker's `mintTurnCredential`.
 */
export function turnRestCredential(
  secret: string,
  subject: string,
  expiresAtMs: number,
  hmacSha1: (key: string, message: string) => Uint8Array
): { username: string; password: string } {
  const username = `${Math.floor(expiresAtMs / 1000)}:${subject}`
  return { username, password: base64(hmacSha1(secret, username)) }
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The first Allocate: no credentials, because the realm and nonce are unknown. */
export function allocateRequest(transactionId: Uint8Array): Uint8Array {
  const transport = new Uint8Array(4)
  transport[0] = TRANSPORT_UDP
  return encodeStun(STUN_METHOD.allocate, STUN_CLASS.request, transactionId, [
    [STUN_ATTR.requestedTransport, transport],
  ])
}

export type AuthChallenge = {
  realm: string
  nonce: string
}

/** The 401 a first Allocate is supposed to get, or null if it was not one. */
export function readChallenge(message: StunMessage): AuthChallenge | null {
  const realm = attributeText(message, STUN_ATTR.realm)
  const nonce = attributeText(message, STUN_ATTR.nonce)
  if (!realm || !nonce) return null
  return { realm, nonce }
}

/**
 * The authenticated Allocate.
 *
 * MESSAGE-INTEGRITY is an HMAC-SHA1 over the whole message *including* a
 * header length that already accounts for the 24-byte integrity attribute —
 * which is why this builds the message twice, once to sign and once to send.
 * Getting that length wrong produces a 401 that looks exactly like a wrong
 * password, so it is worth stating plainly.
 */
export function authenticatedAllocateRequest(
  transactionId: Uint8Array,
  credential: { username: string; password: string },
  challenge: AuthChallenge,
  hmacSha1Key: (key: Uint8Array, message: Uint8Array) => Uint8Array,
  longTermKey: (username: string, realm: string, password: string) => Uint8Array
): Uint8Array {
  const transport = new Uint8Array(4)
  transport[0] = TRANSPORT_UDP
  const attributes: StunAttributes = [
    [STUN_ATTR.requestedTransport, transport],
    [STUN_ATTR.username, encoder.encode(credential.username)],
    [STUN_ATTR.realm, encoder.encode(challenge.realm)],
    [STUN_ATTR.nonce, encoder.encode(challenge.nonce)],
  ]

  const INTEGRITY_ATTRIBUTE_BYTES = 24
  const signable = encodeStun(
    STUN_METHOD.allocate,
    STUN_CLASS.request,
    transactionId,
    attributes,
    INTEGRITY_ATTRIBUTE_BYTES
  )
  const key = longTermKey(credential.username, challenge.realm, credential.password)
  const integrity = hmacSha1Key(key, signable)

  return encodeStun(STUN_METHOD.allocate, STUN_CLASS.request, transactionId, [
    ...attributes,
    [STUN_ATTR.messageIntegrity, integrity],
  ])
}
