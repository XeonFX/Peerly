/** Single source for the Trystero peer id (must match the room connection id). */
export { selfId } from '@trystero-p2p/core'
export { requireAppId, type Env } from './env.js'
export { generateRoomCode } from './roomCode.js'
export {
  resolveSignalingStrategy,
  signalingLabel,
  type SignalingStrategy,
} from './signaling.js'
export {
  buildRelayUrls,
  DEFAULT_NOSTR_RELAYS,
  expandTurnUrls,
  getIceServers,
  resolveIceServers,
  getNostrRelayConfig,
  getSupabaseRoomConfig,
  getTurnConfig,
  resolveRelayPort,
  resolveRelayUrls,
  type TurnServer,
} from './relays.js'
export {
  clearRuntimeNetworkCredentials,
  configureRuntimeAuthCredentialProvider,
  configureRuntimeAuthTokenProvider,
  getRuntimeAuthCredential,
  getRuntimeNetworkCredentials,
  lookupRendezvousId,
  type RuntimeAuthCredential,
  type RuntimeNetworkCredentials,
} from './runtimeCredentials.js'
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
export { probeTurnCapability, resolveProbeIceServers, type TurnCapability } from './turnCapability.js'
export {
  canonicalizePublicKey,
  DeviceIdentity,
  verifyWithDeviceKeyId,
  type DeviceKeyId,
} from './deviceIdentity.js'
export { deriveUserId } from './userId.js'
export {
  parseOidcDeviceAttestation,
  verifyGoogleDeviceBinding,
  verifyOidcDeviceBinding,
  type OidcDeviceAttestation,
  type VerifiedDeviceBinding,
} from './oidcDeviceBinding.js'
export {
  createPeerIdentityHandshake,
  type PeerIdentityAttestation,
  type PeerIdentityHandshakeDeps,
} from './peerIdentityHandshake.js'
export {
  DEFAULT_EMAIL_VERIFIED_CLAIM,
  extractEmailClaim,
  oidcTokenExpiryMs,
  resetOidcJwksCache,
  verifyOidcIdToken,
  type JwksFetcher,
  type JwkWithKid,
  type OidcIdTokenClaims,
  type VerifyOidcIdTokenOptions,
} from './oidcIdToken.js'
export { renderGoogleSignInButton } from './googleSignIn.js'
export {
  normalizeGoogleAuthBridgeOrigin,
  renderGoogleSignInBridgeButton,
} from './googleAuthBridge.js'
export {
  coordinationMemberId,
  coordinationScope,
  createRelayCoordinator,
  openCoordinationData,
  sealCoordinationData,
  type RelayCoordinationEvent,
  type RelayCoordinator,
  type RelayChannelMember,
  type RelayPresenceMember,
} from './coordination.js'
export {
  createRelayChannel,
  type RelayChannelAction,
  type RelayChannelPeer,
  type RelayChannelPeers,
  type RelayChannelRoom,
} from './relayChannel.js'
export {
  GOOGLE_ISSUERS,
  GOOGLE_JWKS_URL,
  GOOGLE_JWKS_PROXY_PATH,
  resetGoogleJwksCache,
  verifyGoogleIdToken,
  type GoogleIdTokenClaims,
  type VerifyGoogleIdTokenOptions,
} from './googleIdToken.js'
export { avatarInitial, getPeerColor, PEER_COLORS } from './identicon.js'
export { formatClockTime } from './format.js'
export {
  applyDocumentLocaleMetadata,
  type DocumentLocaleMetadata,
} from './documentMetadata.js'
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
  createSignedControlReplayGuard,
  signControl,
  SIGNED_CONTROL_MAX_AGE_MS,
  verifySignedControl,
  type SignedControl,
} from './signedControl.js'
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
export { RealtimeClient, type RealtimeClientConfig } from './realtime/client.js'
export { selectDurableObjectsTransport, type CoordinationTransport } from './realtime/transport.js'
export { revokeRealtimeDevice } from './realtime/runtime.js'
export {
  type DeviceSignerLike,
  type ErrorCode,
  type OidcCredentialProvider,
  type RealtimeDeltaEvent,
  type RealtimeFrame,
  type RoomEntry,
  type RoomPage,
  type ScopeHandle,
  type ScopeKind,
  type SeekOptions,
  type TransportDiagnostics,
  type TransportState,
} from './realtime/types.js'
