export type RealtimeFrame = {
  v: 1
  id: string
  type: string
  scope?: string
  seq?: number
  sentAt: number
  payload?: unknown
}

export type ErrorCode =
  | 'invalid-frame' | 'auth-required' | 'version-unsupported'
  | 'rate-limited' | 'too-large' | 'cap-exceeded'
  | 'not-found' | 'conflict' | 'service-unavailable' | 'internal'

export type ScopeKind = 'workspace' | 'dm' | 'room' | 'chat'

export type ScopeHandle = {
  routeId: string
  expiresAt: number
}

export type RoomEntry = Record<string, unknown>

export type RoomPage = {
  entries: Array<{ roomId: string; entry: RoomEntry }>
  cursor: string | null
}

export type SeekOptions = {
  seekId: string
  interests: string[]
  exclusions?: string[]
}

export type RealtimeDeltaEvent =
  | { kind: 'invite'; body: { inviteId: string; from: string; kind: string; body: object } }
  | { kind: 'invite.acked'; body: { inviteId: string } }
  | { kind: 'ring'; body: { from: string; roomRoute: string } }
  | { kind: 'seek.state'; body: Record<string, unknown> }
  | { kind: 'match.commit'; body: { matchId: string; routeId: string; initiator: boolean; peer: { opaqueUserId: string } } }
  | { kind: 'directory.change'; body: Record<string, unknown> }
  | { kind: 'workspace.presence'; body: { uid: string; state: string } }
  | { kind: 'device.revoked'; body: Record<string, unknown> }
  | { kind: 'sync.notice'; body: Record<string, unknown> }

export type TransportState = 'offline' | 'enrolling' | 'session' | 'connecting' | 'ready' | 'backoff' | 'upgrade-required'

export type TransportDiagnostics = {
  state: TransportState
  reconnectCount: number
  lastEventAt: number | null
  degraded: boolean
}

export type DeviceSignerLike = {
  publicKeyId(): Promise<string>
  sign(data: Uint8Array): Promise<string>
}

export type OidcCredentialProvider = () => Promise<{ token: string; providerId: string; signer: DeviceSignerLike } | null>
