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
export {
  GOOGLE_ISSUERS,
  GOOGLE_JWKS_URL,
  resetGoogleJwksCache,
  verifyGoogleIdToken,
  type GoogleIdTokenClaims,
  type VerifyGoogleIdTokenOptions,
} from './googleIdToken.js'
export { avatarInitial, getPeerColor, PEER_COLORS } from './identicon.js'
export { formatClockTime } from './format.js'
export { createRoomMedia, type RoomMediaController, type RoomMediaState } from './roomMedia.js'
export { createKvStore, type KvStore } from './kvStore.js'
export { createBlobStore } from './blobStore.js'
export { openIndexedDb } from './idb.js'
export { isSafeAvatarUrl, safeAvatarUrl } from './avatarSafety.js'
export { processAvatarBlob, processAvatarImage } from './avatarImage.js'
export {
  base64UrlToBytes,
  base64UrlToUtf8,
  bytesToBase64Url,
  utf8ToBase64Url,
} from './base64url.js'
export { encodeCanonicalLines } from './canonical.js'
export {
  applyToggleReaction,
  isAcceptableRevision,
  mergeReactionsByActorKey,
  revisionScore,
  upsertByIdSorted,
  type RevisionFields,
} from './messageMerge.js'
export {
  attentionSoundPreferenceKey,
  formatUnreadTitle,
  loadAttentionSoundsEnabled,
  playMatchChime,
  playNotificationChime,
  primeAttentionAudio,
  saveAttentionSoundsEnabled,
  startIncomingCallRingtone,
} from './attentionSound.js'
export {
  DEFAULT_HISTORY_CAP,
  signTextChat,
  signTextReaction,
  textChatBytes,
  textReactionBytes,
  verifyTextChat,
  verifyTextReaction,
  type DeviceSigner,
  type TextChatWire,
  type TextReactionWire,
} from './textChatSigning.js'
