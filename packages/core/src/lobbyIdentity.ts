import { getRuntimeAuthCredential } from './runtimeCredentials.js'

export type LobbyIdentity = {
  userId: string
  deviceKeyId: string
  rendezvousId: string
  expiresAt: number
}
export type LobbyCertificate = LobbyIdentity & { certificate: string }

function identityOf(raw: unknown): LobbyIdentity | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<LobbyIdentity>
  if (typeof value.userId !== 'string' || typeof value.deviceKeyId !== 'string' ||
    typeof value.rendezvousId !== 'string' || typeof value.expiresAt !== 'number' ||
    value.expiresAt <= Date.now()) return null
  return value as LobbyIdentity
}

/** One client per lobby lifecycle. No persistent provider tokens or certificates. */
export function createLobbyIdentityClient() {
  let issued: LobbyCertificate | null = null
  let issuedFor = ''
  let issuing: Promise<LobbyCertificate | null> | null = null
  const verified = new Map<string, LobbyIdentity>()
  const verifying = new Map<string, Promise<LobbyIdentity | null>>()
  return {
    async issue(): Promise<LobbyCertificate | null> {
      const auth = await getRuntimeAuthCredential()
      if (!auth) return null
      const deviceKeyId = await auth.signer.publicKeyId()
      const identityKey = `${auth.providerId}\n${deviceKeyId}\n${auth.token}`
      if (issuedFor === identityKey && issued && issued.expiresAt > Date.now() + 30_000) return issued
      if (issuing && issuedFor === identityKey) return issuing
      issuedFor = identityKey
      const operation = (async () => {
        try {
          const timestamp = Date.now()
          const nonce = crypto.randomUUID()
          const signature = await auth.signer.sign(new TextEncoder().encode([
            'peerly-lobby-identity-v1', auth.providerId, deviceKeyId, String(timestamp), nonce,
          ].join('\n')))
          const response = await fetch('/api/rendezvous/presence', { method: 'POST', headers: {
            authorization: `Bearer ${auth.token}`,
            'x-peerly-provider': auth.providerId,
            'x-peerly-device-key': deviceKeyId,
            'x-peerly-request-ts': String(timestamp),
            'x-peerly-request-nonce': nonce,
            'x-peerly-request-signature': signature,
          } })
          if (!response.ok) return null
          const raw = await response.json() as Partial<LobbyCertificate>
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
    async verify(certificate: unknown): Promise<LobbyIdentity | null> {
      if (typeof certificate !== 'string' || certificate.length > 2048) return null
      const cached = verified.get(certificate)
      if (cached && cached.expiresAt > Date.now()) return cached
      verified.delete(certificate)
      if (verifying.has(certificate)) return verifying.get(certificate)!
      if (verifying.size >= 32) return null
      const operation = (async () => {
        try {
          const response = await fetch('/api/rendezvous/verify', {
            method: 'POST', headers: { 'content-type': 'text/plain' }, body: certificate,
          })
          if (!response.ok) return null
          const identity = identityOf(await response.json())
          if (!identity) return null
          verified.set(certificate, identity)
          if (verified.size > 1000) verified.delete(verified.keys().next().value!)
          return identity
        } catch { return null }
        finally { verifying.delete(certificate) }
      })()
      verifying.set(certificate, operation)
      return operation
    },
  }
}
