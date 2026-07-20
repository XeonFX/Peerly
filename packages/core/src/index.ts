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
  getIceServers,
  getNostrRelayConfig,
  getSupabaseRoomConfig,
  getTurnConfig,
  resolveRelayPort,
  resolveRelayUrls,
  type TurnServer,
} from './relays.js'
export {
  classifyJoinError,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  isRecoverableJoinError,
  joinRoomByCode,
  type JoinErrorKind,
  type JoinRoomOptions,
  type Room,
} from './joinRoom.js'
export { isReplaceOnlyUpgrade, planTrackOps, type TrackOp } from './mediaTracks.js'
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
export {
  createRoomMedia,
  type RoomMediaController,
  type RoomMediaDeviceIds,
  type RoomMediaState,
} from './roomMedia.js'
export { createKvStore, type KvStore } from './kvStore.js'
export { createBlobStore } from './blobStore.js'
export { openIndexedDb } from './idb.js'
export {
  isAllowedGoogleAvatarUrl,
  isSafeAvatarUrl,
  safeAvatarUrl,
} from './avatarSafety.js'
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
export {
  addPeopleEntry,
  addPeopleSubscription,
  createPeopleAttestation,
  decodeSharedPeopleList,
  effectiveSubjectUserIds,
  emptyPeopleList,
  encodeSharedPeopleList,
  isSubjectListed,
  loadPeopleList,
  ownEntriesNewestFirst,
  peopleAttestationBytes,
  removePeopleEntry,
  removePeopleSubscription,
  savePeopleList,
  verifyPeopleAttestation,
  verifySharedPeopleList,
  type PeopleAttestation,
  type PeopleList,
  type PeopleListKind,
  type PeopleSubscription,
  type SharedPeopleList,
} from './peopleList.js'
export { dmRoomCode, generateDmSecret, isValidDmSecret } from './dmRoomCode.js'
export {
  createDmCredentialStore,
  type DmCredential,
  type DmCredentialStore,
} from './dmCredentials.js'
export {
  decideDmRingToast,
  dmRingBytes,
  DM_RING_TOAST_COOLDOWN_MS,
  isValidDmRoomCode,
  parseDmRingPayload,
  signDmRing,
  verifyDmRing,
  type DmRingPayload,
  type DmRingReason,
  type DmRingToastDecision,
} from './dmRing.js'
export {
  applyAudioOutput,
  audioOutputSelectionSupported,
  inferJoinMode,
  listMediaDevices,
  type CallMediaMode,
  type MediaDeviceLists,
} from './mediaDevices.js'
export {
  createMediaDevicePrefs,
  type MediaDevicePrefs,
  type MediaDevicePrefsConfig,
} from './mediaDevicePrefs.js'
export {
  createMeshIsolation,
  isProductionHost,
  meshId,
  sanitizeMeshHost,
  type MeshIsolation,
  type MeshIsolationConfig,
} from './meshIsolation.js'
export {
  createPresenceIndex,
  parsePresencePayload,
  PRESENCE_INTERVAL_MS,
  PRESENCE_TTL_MS,
  type ParsePresenceOptions,
  type PresenceEntry,
  type PresenceIndex,
  type PresencePayload,
} from './presence.js'
export {
  createTextChatHistoryStore,
  mergeTextChatWires,
  mergeTextReactionWires,
  parseTextChatHistoryEnvelope,
  type StoredTextChatHistory,
  type TextChatHistoryConfig,
  type TextChatHistoryEnvelope,
  type TextChatHistoryStore,
} from './textChatHistory.js'
export {
  clearSyncActivities,
  getSyncActivities,
  recordSyncActivity,
  subscribeSyncActivities,
  syncPayloadBytes,
  type SyncActivity,
  type SyncActivityInput,
  type SyncDataKind,
  type SyncDirection,
  type SyncPeer,
  type SyncRelationship,
} from './syncActivity.js'
export {
  createSpeakingDetector,
  type SpeakingDetector,
  type SpeakingDetectorOptions,
} from './speaking.js'
export {
  applyNsfwScanResult,
  canvasFromVisualSource,
  CONSECUTIVE_CLEAN_TO_CLEAR,
  CONSECUTIVE_FLAGS_REQUIRED,
  createInferencePool,
  INITIAL_NSFW_SCAN_STATE,
  NSFW_CANVAS_MAX_EDGE,
  NSFW_EXPLICIT_THRESHOLD,
  NSFW_MAX_CONCURRENT_INFERENCES,
  NSFW_SUGGESTIVE_THRESHOLD,
  shouldFlagNsfw,
  VIDEO_SCREEN_INTERVAL_MS,
  videoScreeningDelay,
  type InferencePool,
  type NsfwPrediction,
  type NsfwScreenScanState,
  type VisualSource,
} from './nsfwPolicy.js'
