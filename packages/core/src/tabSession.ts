import { bytesToBase64Url } from './base64url.js'
import { canonicalizePublicKey, verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import type { DeviceSigner } from './textChatSigning.js'

const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const

/** What a tab certificate signs first, so it is no signature over anything else the device key signs. */
const TAB_CERTIFICATE_DOMAIN = 'peerly-tab-session-v1'
/** How long a certificate is valid. A tab re-issues its own well before this, so peers never see it lapse. */
export const TAB_CERTIFICATE_LIFETIME_MS = 60 * 60_000
/** A tab re-issues its certificate once less than this is left. */
const TAB_CERTIFICATE_RENEW_MS = 15 * 60_000
/** Clock difference tolerated between two devices, as for ID tokens. */
export const TAB_CERTIFICATE_SKEW_MS = 5 * 60_000

/**
 * The device key's statement "this tab key speaks for me, in this context, until `expiresAt`". Every tab of one
 * browser profile shares the device key (it is what the sign-in is bound to), so the device key alone cannot tell two
 * tabs apart; the tab key can. The certificate carries no peer input: a tab issues it before it talks to anyone.
 */
export type TabCertificate = {
  tabKeyId: DeviceKeyId
  issuedAt: number
  expiresAt: number
  signature: string
}

export type TabCertificateCheck = 'valid' | 'expired' | 'invalid'

/** The bytes a tab certificate signs: the domain, the context it is valid in, the device key and the tab key it binds. */
export function tabCertificateBytes(fields: {
  context: string
  deviceKeyId: DeviceKeyId
  tabKeyId: DeviceKeyId
  issuedAt: number
  expiresAt: number
}): Uint8Array {
  const { context, deviceKeyId, tabKeyId, issuedAt, expiresAt } = fields
  return new TextEncoder().encode(
    JSON.stringify([TAB_CERTIFICATE_DOMAIN, context, deviceKeyId, tabKeyId, issuedAt, expiresAt])
  )
}

/** A peer-sent certificate in exactly the expected shape, or null. Every field is attacker-controlled. */
export function parseTabCertificate(raw: unknown): TabCertificate | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.tabKeyId !== 'string' || !value.tabKeyId || value.tabKeyId.length > 512) return null
  if (typeof value.signature !== 'string' || !value.signature || value.signature.length > 512) return null
  if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)) return null
  return {
    tabKeyId: value.tabKeyId,
    issuedAt: value.issuedAt as number,
    expiresAt: value.expiresAt as number,
    signature: value.signature,
  }
}

/**
 * Whether `cert` was signed by `deviceKeyId` for this `context` and is current. A certificate that claims a longer life
 * than any tab issues, or one issued in the future, is invalid rather than merely expired.
 */
export async function verifyTabCertificate(
  cert: TabCertificate,
  options: { context: string; deviceKeyId: DeviceKeyId; now?: number }
): Promise<TabCertificateCheck> {
  const now = options.now ?? Date.now()
  if (cert.tabKeyId === options.deviceKeyId) return 'invalid'
  if (cert.expiresAt <= cert.issuedAt || cert.expiresAt - cert.issuedAt > TAB_CERTIFICATE_LIFETIME_MS) return 'invalid'
  if (cert.issuedAt > now + TAB_CERTIFICATE_SKEW_MS) return 'invalid'
  const signed = await verifyWithDeviceKeyId(
    options.deviceKeyId,
    tabCertificateBytes({ context: options.context, deviceKeyId: options.deviceKeyId, ...cert }),
    cert.signature
  )
  if (!signed) return 'invalid'
  return cert.expiresAt + TAB_CERTIFICATE_SKEW_MS <= now ? 'expired' : 'valid'
}

/**
 * This tab's own key: P-256, non-extractable, generated in memory on first use and never stored, so it exists exactly as
 * long as the page does and a reload is a new tab. The device key certifies it per context (`certificate`); handshake
 * proofs are signed with it (`sign`), so the device key itself no longer signs anything in a handshake.
 */
export class TabSession implements DeviceSigner {
  private readonly device: DeviceSigner
  private readonly now: () => number
  private pair: Promise<CryptoKeyPair> | null = null
  private keyIdPromise: Promise<DeviceKeyId> | null = null
  private readonly certificates = new Map<string, Promise<TabCertificate>>()

  constructor(device: DeviceSigner, options: { now?: () => number } = {}) {
    this.device = device
    this.now = options.now ?? Date.now
  }

  private keyPair(): Promise<CryptoKeyPair> {
    this.pair ??= crypto.subtle.generateKey(KEY_ALGORITHM, false, ['sign', 'verify']) as Promise<CryptoKeyPair>
    return this.pair
  }

  /** The tab key's id, in the same `P-256:<x>:<y>` form as a device key id. */
  publicKeyId(): Promise<DeviceKeyId> {
    this.keyIdPromise ??= this.keyPair().then(pair => canonicalizePublicKey(pair.publicKey))
    return this.keyIdPromise
  }

  /** The device this tab belongs to. */
  deviceKeyId(): Promise<DeviceKeyId> {
    return this.device.publicKeyId()
  }

  async sign(data: Uint8Array): Promise<string> {
    const { privateKey } = await this.keyPair()
    const signature = await crypto.subtle.sign(SIGN_ALGORITHM, privateKey, data as BufferSource)
    return bytesToBase64Url(new Uint8Array(signature))
  }

  /** The device key's certificate for this tab key in `context`, re-issued when it nears expiry. */
  async certificate(context: string): Promise<TabCertificate> {
    const cached = this.certificates.get(context)
    if (cached) {
      const cert = await cached.catch(() => null)
      if (cert && cert.expiresAt - this.now() > TAB_CERTIFICATE_RENEW_MS) return cert
      if (this.certificates.get(context) !== cached) return this.certificate(context)
    }
    const issuing = this.issue(context)
    this.certificates.set(context, issuing)
    issuing.catch(() => {
      if (this.certificates.get(context) === issuing) this.certificates.delete(context)
    })
    return issuing
  }

  private async issue(context: string): Promise<TabCertificate> {
    const [deviceKeyId, tabKeyId] = await Promise.all([this.device.publicKeyId(), this.publicKeyId()])
    const issuedAt = this.now()
    const expiresAt = issuedAt + TAB_CERTIFICATE_LIFETIME_MS
    const signature = await this.device.sign(tabCertificateBytes({ context, deviceKeyId, tabKeyId, issuedAt, expiresAt }))
    return { tabKeyId, issuedAt, expiresAt, signature }
  }
}

