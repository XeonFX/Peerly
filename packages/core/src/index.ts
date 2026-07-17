/** Single source for the Trystero peer id (must match the room connection id). */
export { selfId } from '@trystero-p2p/core'
export type { Env } from './env.js'
export { generateRoomCode } from './roomCode.js'
export {
  resolveSignalingStrategy,
  signalingLabel,
  type SignalingStrategy,
} from './signaling.js'
export {
  buildRelayUrls,
  DEFAULT_NOSTR_RELAYS,
  getNostrRelayConfig,
  getSupabaseRoomConfig,
  getTurnConfig,
  resolveRelayPort,
  resolveRelayUrls,
  type TurnServer,
} from './relays.js'
export {
  classifyJoinError,
  joinRoomByCode,
  type JoinErrorKind,
  type JoinRoomOptions,
  type Room,
} from './joinRoom.js'
export { createRelayHealth, type RelayHealth } from './relayHealth.js'
export { probeNostrRelay, probeNostrRelays, type RelayProbeResult } from './relayProbe.js'
export { probeP2pCapability, type P2pCapability } from './p2pCapability.js'
export {
  canonicalizePublicKey,
  DeviceIdentity,
  verifyWithDeviceKeyId,
  type DeviceKeyId,
} from './deviceIdentity.js'
export { deriveUserId } from './userId.js'
export {
  DEFAULT_EMAIL_VERIFIED_CLAIM,
  extractEmailClaim,
  resetOidcJwksCache,
  verifyOidcIdToken,
  type JwksFetcher,
  type JwkWithKid,
  type OidcIdTokenClaims,
  type VerifyOidcIdTokenOptions,
} from './oidcIdToken.js'
export { renderGoogleSignInButton } from './googleSignIn.js'
export { createKvStore, type KvStore } from './kvStore.js'
export {
  base64UrlToBytes,
  base64UrlToUtf8,
  bytesToBase64Url,
  utf8ToBase64Url,
} from './base64url.js'
