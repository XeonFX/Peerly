import { createIdentityRoutes } from './identity.mjs'
const lobby = createIdentityRoutes({ purpose: 'peerly-lobby-identity-v1', rendezvous: true,
  secret: env => env.RENDEZVOUS_SECRET, limiter: env => env.RENDEZVOUS_RATE_LIMITER })
export const issueLobbyIdentity = lobby.issue
export const verifyLobbyIdentity = lobby.verify
