import { createIdentityClient, type AppIdentity } from './identityCertificate.js'
export type LobbyIdentity = AppIdentity & { rendezvousId: string }
export type LobbyCertificate = LobbyIdentity & { certificate: string }

/** Backward-compatible discovery client used by Peerly. */
export function createLobbyIdentityClient() {
  const client = createIdentityClient({ issuePath: '/api/rendezvous/presence',
    verifyPath: '/api/rendezvous/verify', purpose: 'peerly-lobby-identity-v1' })
  function lobby<T extends AppIdentity>(identity: T | null): (T & { rendezvousId: string }) | null {
    if (!identity || !('rendezvousId' in identity) || typeof identity.rendezvousId !== 'string') return null
    return { ...identity, rendezvousId: identity.rendezvousId }
  }
  return {
    issue: async () => lobby(await client.issue()),
    verify: async (certificate: unknown) => lobby(await client.verify(certificate)),
  }
}
