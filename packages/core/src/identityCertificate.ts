import { getRuntimeAuthCredential } from './runtimeCredentials.js'

export type AppIdentity = {
  userId: string
  deviceKeyId: string
  expiresAt: number
}
export type AppCertificate = AppIdentity & { certificate: string }

function identityOf(raw: unknown, atTime = Date.now()): AppIdentity | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<AppIdentity>
  if (typeof value.userId !== 'string' || typeof value.deviceKeyId !== 'string' ||
    typeof value.expiresAt !== 'number' ||
    value.expiresAt <= atTime || value.expiresAt > atTime + 330_000) return null
  return value as AppIdentity
}

/** One client per lobby lifecycle. No persistent provider tokens or certificates. */
export function createIdentityClient(options: { issuePath?: string; verifyPath?: string; purpose?: string } = {}) {
  let issued: AppCertificate | null = null
  let issuedFor = ''
  let issuing: Promise<AppCertificate | null> | null = null
  const verified = new Map<string, AppIdentity>()
  const verifying = new Map<string, Promise<AppIdentity | null>>()
  return {
    async issue(): Promise<AppCertificate | null> {
      const auth = await getRuntimeAuthCredential()
      if (!auth) return null
      const deviceKeyId = await auth.signer.publicKeyId()
      const identityKey = `${auth.providerId}\n${deviceKeyId}\n${auth.token}`
      if (issuedFor === identityKey && issued && issued.expiresAt > Date.now() + 30_000) return issued
      if (issuing && issuedFor === identityKey) return issuing
      if (issuedFor !== identityKey) issued = null
      issuedFor = identityKey
      const operation = (async () => {
        try {
          const timestamp = Date.now()
          const nonce = crypto.randomUUID()
          const signature = await auth.signer.sign(new TextEncoder().encode([
            options.purpose ?? 'peerly-app-identity-v1', auth.providerId, deviceKeyId, String(timestamp), nonce,
          ].join('\n')))
          const response = await fetch(options.issuePath ?? '/api/identity/issue', { method: 'POST', headers: {
            authorization: `Bearer ${auth.token}`,
            'x-peerly-provider': auth.providerId,
            'x-peerly-device-key': deviceKeyId,
            'x-peerly-request-ts': String(timestamp),
            'x-peerly-request-nonce': nonce,
            'x-peerly-request-signature': signature,
          } })
          if (!response.ok) return null
          const raw = await response.json() as Partial<AppCertificate>
          const identity = identityOf(raw)
          if (!identity || identity.deviceKeyId !== deviceKeyId || typeof raw.certificate !== 'string') return null
          const result = { ...identity, certificate: raw.certificate }
          if (issuedFor === identityKey) issued = result
          return result
        } catch { return null }
      })()
      issuing = operation
      try { return await operation } finally { if (issuing === operation) issuing = null }
    },
    async verify(certificate: unknown, atTime?: number): Promise<AppIdentity | null> {
      if (typeof certificate !== 'string' || certificate.length > 2048) return null
      const cacheKey = `${certificate}:${atTime ?? 'live'}`
      const cached = verified.get(cacheKey)
      if (cached && cached.expiresAt > (atTime ?? Date.now())) return cached
      verified.delete(cacheKey)
      if (verifying.has(cacheKey)) return verifying.get(cacheKey)!
      if (verifying.size >= 32) return null
      const operation = (async () => {
        try {
          const response = await fetch(options.verifyPath ?? '/api/identity/verify', {
            method: 'POST', headers: { 'content-type': 'text/plain', ...(atTime === undefined ? {} : { 'x-peerly-at-time': String(atTime) }) }, body: certificate,
          })
          if (!response.ok) return null
          const identity = identityOf(await response.json(), atTime)
          if (!identity) return null
          verified.set(cacheKey, identity)
          if (verified.size > 1000) verified.delete(verified.keys().next().value!)
          return identity
        } catch { return null }
        finally { verifying.delete(cacheKey) }
      })()
      verifying.set(cacheKey, operation)
      return operation
    },
  }
}

