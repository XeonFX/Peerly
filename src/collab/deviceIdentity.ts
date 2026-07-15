import { createKvStore, type KvStore } from '../utils/kvStore'
import { base64UrlToBytes, bytesToBase64Url } from '../utils/base64url'

const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const
const STORE_KEY = 'device-keypair'

/** Canonical, compact identifier for a P-256 public key: `P-256:<x>:<y>` (base64url coordinates). */
export type DeviceKeyId = string

/**
 * One ECDSA keypair per browser profile, persisted across reloads.
 *
 * This is the thing a live challenge-response is verified against during the
 * identity handshake (see identityHandshake.ts) — it is what turns "Google says
 * someone owns this email" into "the peer I am connected to, right now, is that
 * someone." Without it, a Google ID token is a bearer credential: whoever holds
 * a copy of the JWT string can present it to any peer within its validity
 * window, including a peer who only ever *observed* someone else present it.
 *
 * The private key is generated NON-extractable and never leaves WebCrypto. It
 * still persists across reloads: an unextractable CryptoKey is structured-
 * cloneable, so IndexedDB stores the key object itself rather than any material
 * we could read back. The public key stays exportable, which is all
 * canonicalizePublicKey needs.
 *
 * This bounds what an XSS on our own origin can do. It can still sign while it
 * has script running on the page — that is unavoidable — but it cannot copy the
 * key out. Extractable, one XSS yields the key plus the ID token from
 * sessionStorage, which together impersonate the user to every peer
 * indefinitely, offline, long after the page is closed. That is a much larger
 * blast radius for no benefit: nothing here needs to read the private key.
 */
export class DeviceIdentity {
  private readonly store: KvStore<CryptoKeyPair>
  private cached: CryptoKeyPair | null = null

  constructor(store: KvStore<CryptoKeyPair> = createKvStore('peerly-identity', 'keys')) {
    this.store = store
  }

  private async keyPair(): Promise<CryptoKeyPair> {
    if (this.cached) return this.cached

    const stored = await this.store.get(STORE_KEY)
    if (stored) {
      this.cached = stored
      return stored
    }

    // extractable: false — applies to the private key only; the public key
    // remains exportable, which is what publicKeyId() needs.
    const pair = (await crypto.subtle.generateKey(KEY_ALGORITHM, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    await this.store.set(STORE_KEY, pair)
    this.cached = pair
    return pair
  }

  async publicKeyId(): Promise<DeviceKeyId> {
    const { publicKey } = await this.keyPair()
    return canonicalizePublicKey(publicKey)
  }

  async sign(data: Uint8Array): Promise<string> {
    const { privateKey } = await this.keyPair()
    const signature = await crypto.subtle.sign(SIGN_ALGORITHM, privateKey, data as BufferSource)
    return bytesToBase64Url(new Uint8Array(signature))
  }
}

export async function canonicalizePublicKey(key: CryptoKey): Promise<DeviceKeyId> {
  const jwk = await crypto.subtle.exportKey('jwk', key)
  return `P-256:${jwk.x}:${jwk.y}`
}

function importDeviceKeyId(keyId: DeviceKeyId): Promise<CryptoKey> {
  const [curve, x, y] = keyId.split(':')
  if (curve !== 'P-256' || !x || !y) {
    throw new Error('Malformed device key id')
  }
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, ext: true, key_ops: ['verify'] },
    KEY_ALGORITHM,
    true,
    ['verify']
  )
}

/**
 * Verify a signature against a peer-claimed device key id. Never throws on bad
 * input — a malformed or forged key id is just "not verified", the same as any
 * other signature mismatch, so callers can treat every failure mode uniformly.
 */
export async function verifyWithDeviceKeyId(
  keyId: DeviceKeyId,
  data: Uint8Array,
  signature: string
): Promise<boolean> {
  try {
    const key = await importDeviceKeyId(keyId)
    return await crypto.subtle.verify(SIGN_ALGORITHM, key, base64UrlToBytes(signature) as BufferSource, data as BufferSource)
  } catch {
    return false
  }
}
