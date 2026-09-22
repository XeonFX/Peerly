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
  /**
   * This seeker's id in the app's own opaque id space — the same space
   * `exclusions` is written in. Everything the server does with either is an
   * equality comparison, so the app can use an id derivable from a user id it
   * already knows (see the consumer's opaque coordination scope) and keep its blocklist
   * client-side. Omit it and exclusions cannot match anything.
   */
  memberId?: string
  exclusions?: string[]
}

/**
 * Every event the gateway can actually deliver — and only those.
 *
 * Four more used to be listed here: `invite.acked`, `seek.state`,
 * `directory.change` and `sync.notice`. Nothing emitted any of them, in either
 * runtime, so each was an impossible case that every exhaustive handler had to
 * carry and no test could reach. `directory.change` in particular is real
 * planned work — the push that would retire the room-directory poll — and is
 * recorded in docs/REWRITE_ARCHITECTURE.md, which is where a plan belongs. A
 * type union is a claim about what the system does, not a list of intentions.
 */
export type RealtimeDeltaEvent =
  | { kind: 'invite'; body: { inviteId: string; from: string; kind: string; body: object } }
  | { kind: 'ring'; body: { from: string; roomRoute: string } }
  | {
      kind: 'match.commit'
      body: {
        matchId: string
        routeId: string
        initiator: boolean
        peer: { opaqueUserId: string; memberId?: string }
      }
    }
  | { kind: 'device.revoked'; body: Record<string, unknown> }

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
