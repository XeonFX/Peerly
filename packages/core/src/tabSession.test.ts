import { describe, expect, it } from 'vitest'
import { DeviceIdentity, verifyWithDeviceKeyId } from './deviceIdentity.js'
import {
  TAB_CERTIFICATE_LIFETIME_MS,
  TAB_CERTIFICATE_SKEW_MS,
  TabSession,
  parseTabCertificate,
  tabCertificateBytes,
  verifyTabCertificate,
} from './tabSession.js'

function device() {
  const keys = new Map<string, CryptoKeyPair>()
  return new DeviceIdentity({
    get: async key => keys.get(key) ?? null,
    set: async (key, value) => { keys.set(key, value) },
  })
}

const CONTEXT = 'workspace:creator'

describe('tab sessions', () => {
  it('gives two tabs of one device distinct keys under the same device key', async () => {
    const shared = device()
    const first = new TabSession(shared)
    const second = new TabSession(shared)
    expect(await first.deviceKeyId()).toBe(await second.deviceKeyId())
    expect(await first.publicKeyId()).not.toBe(await second.publicKeyId())
    expect(await first.publicKeyId()).not.toBe(await shared.publicKeyId())
  })

  it('certifies the tab key with the device key, for one context', async () => {
    const shared = device()
    const tab = new TabSession(shared)
    const cert = await tab.certificate(CONTEXT)
    const deviceKeyId = await shared.publicKeyId()
    expect(cert.tabKeyId).toBe(await tab.publicKeyId())
    expect(cert.expiresAt - cert.issuedAt).toBe(TAB_CERTIFICATE_LIFETIME_MS)
    await expect(verifyTabCertificate(cert, { context: CONTEXT, deviceKeyId })).resolves.toBe('valid')
    // Bound to the context and to the device: another workspace or another device key does not accept it.
    await expect(verifyTabCertificate(cert, { context: 'workspace:other', deviceKeyId })).resolves.toBe('invalid')
    await expect(verifyTabCertificate(cert, { context: CONTEXT, deviceKeyId: await device().publicKeyId() })).resolves.toBe('invalid')
  })

  it('refuses a certificate whose fields were changed after signing', async () => {
    const shared = device()
    const deviceKeyId = await shared.publicKeyId()
    const cert = await new TabSession(shared).certificate(CONTEXT)
    const otherTab = await new TabSession(shared).publicKeyId()
    for (const forged of [
      { ...cert, tabKeyId: otherTab },
      { ...cert, expiresAt: cert.expiresAt + 1 },
      { ...cert, issuedAt: cert.issuedAt - 1 },
      { ...cert, signature: cert.signature.slice(0, -2) + (cert.signature.endsWith('AA') ? 'BB' : 'AA') },
    ]) {
      await expect(verifyTabCertificate(forged, { context: CONTEXT, deviceKeyId })).resolves.toBe('invalid')
    }
  })

  it('reports an expired certificate as stale, past the clock-skew allowance', async () => {
    const shared = device()
    const deviceKeyId = await shared.publicKeyId()
    const cert = await new TabSession(shared).certificate(CONTEXT)
    const justAfter = cert.expiresAt + TAB_CERTIFICATE_SKEW_MS - 1
    await expect(verifyTabCertificate(cert, { context: CONTEXT, deviceKeyId, now: justAfter })).resolves.toBe('valid')
    await expect(verifyTabCertificate(cert, { context: CONTEXT, deviceKeyId, now: cert.expiresAt + TAB_CERTIFICATE_SKEW_MS })).resolves.toBe('expired')
  })

  it('refuses certificates no tab issues: longer-lived, issued in the future, or naming the device key as the tab key', async () => {
    const shared = device()
    const deviceKeyId = await shared.publicKeyId()
    const tabKeyId = await new TabSession(shared).publicKeyId()
    const sign = async (fields: { tabKeyId: string; issuedAt: number; expiresAt: number }) => ({
      ...fields,
      signature: await shared.sign(tabCertificateBytes({ context: CONTEXT, deviceKeyId, ...fields })),
    })
    const now = Date.now()
    const forever = await sign({ tabKeyId, issuedAt: now, expiresAt: now + 10 * TAB_CERTIFICATE_LIFETIME_MS })
    const future = await sign({ tabKeyId, issuedAt: now + 2 * TAB_CERTIFICATE_SKEW_MS, expiresAt: now + 2 * TAB_CERTIFICATE_SKEW_MS + 1000 })
    const self = await sign({ tabKeyId: deviceKeyId, issuedAt: now, expiresAt: now + 1000 })
    for (const cert of [forever, future, self]) {
      await expect(verifyTabCertificate(cert, { context: CONTEXT, deviceKeyId, now })).resolves.toBe('invalid')
    }
  })

  it('re-issues the certificate before it lapses, keeping the tab key', async () => {
    let now = 1_000_000
    const tab = new TabSession(device(), { now: () => now })
    const first = await tab.certificate(CONTEXT)
    expect(await tab.certificate(CONTEXT)).toBe(first)
    now = first.expiresAt - 60_000
    const renewed = await tab.certificate(CONTEXT)
    expect(renewed).not.toBe(first)
    expect(renewed.tabKeyId).toBe(first.tabKeyId)
    expect(renewed.issuedAt).toBe(now)
  })

  it('signs with the tab key, which never leaves WebCrypto', async () => {
    const tab = new TabSession(device())
    const data = new TextEncoder().encode('transcript')
    const signature = await tab.sign(data)
    await expect(verifyWithDeviceKeyId(await tab.publicKeyId(), data, signature)).resolves.toBe(true)
    await expect(verifyWithDeviceKeyId(await tab.deviceKeyId(), data, signature)).resolves.toBe(false)
    const pair = await (tab as unknown as { keyPair: () => Promise<CryptoKeyPair> }).keyPair()
    expect(pair.privateKey.extractable).toBe(false)
  })

  it.each([
    null, 'cert', {}, { tabKeyId: 'k', issuedAt: 1, expiresAt: 2 },
    { tabKeyId: '', issuedAt: 1, expiresAt: 2, signature: 's' },
    { tabKeyId: 'k'.repeat(513), issuedAt: 1, expiresAt: 2, signature: 's' },
    { tabKeyId: 'k', issuedAt: '1', expiresAt: 2, signature: 's' },
    { tabKeyId: 'k', issuedAt: 1.5, expiresAt: 2, signature: 's' },
    { tabKeyId: 'k', issuedAt: 1, expiresAt: 2, signature: 's'.repeat(513) },
  ])('parses only the exact certificate shape (%j)', raw => {
    expect(parseTabCertificate(raw)).toBeNull()
  })
})
