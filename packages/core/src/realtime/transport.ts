import { RealtimeClient, type RealtimeClientConfig } from './client.js'
import type { RoomEntry, RoomPage, ScopeHandle, ScopeKind, SeekOptions, TransportDiagnostics } from './types.js'

export interface CoordinationTransport {
  connect(): Promise<void>
  close(): void
  requestScope(kind: ScopeKind, capability: string): Promise<ScopeHandle>
  startSeek(opts: SeekOptions): Promise<void>
  cancelSeek(seekId: string): Promise<void>
  publishRoom(roomId: string, revision: number, entry: RoomEntry): Promise<void>
  deleteRoom(roomId: string, revision: number): Promise<void>
  listRooms(cursor?: string): Promise<RoomPage>
  sendInvite(to: string, kind: string, body: object): Promise<void>
  /** Revoke one of this account's own devices server-side (sessions + sockets). */
  revokeDevice(deviceKeyId: string): Promise<void>
  releaseScope(routeId: string): Promise<void>
  events: EventTarget
  readonly diagnostics: TransportDiagnostics
}

class DurableObjectTransport implements CoordinationTransport {
  private readonly client: RealtimeClient

  constructor(config: RealtimeClientConfig) {
    this.client = new RealtimeClient(config)
  }

  get events(): EventTarget {
    return this.client
  }

  get diagnostics(): TransportDiagnostics {
    return this.client.diagnostics
  }

  connect(): Promise<void> {
    return this.client.connect()
  }

  close(): void {
    this.client.close()
  }

  async requestScope(kind: ScopeKind, capability: string): Promise<ScopeHandle> {
    return this.client.send<ScopeHandle>('scope.request', { kind, capability })
  }

  async startSeek(opts: SeekOptions): Promise<void> {
    await this.client.send('seek.start', opts)
  }

  async cancelSeek(seekId: string): Promise<void> {
    await this.client.send('seek.cancel', { seekId })
  }

  async publishRoom(roomId: string, revision: number, entry: RoomEntry): Promise<void> {
    await this.client.send('directory.publish', { roomId, revision, entry })
  }

  async deleteRoom(roomId: string, revision: number): Promise<void> {
    await this.client.send('directory.delete', { roomId, revision })
  }

  async listRooms(cursor?: string): Promise<RoomPage> {
    return this.client.send<RoomPage>('directory.list', cursor ? { cursor } : undefined)
  }

  async sendInvite(to: string, kind: string, body: object): Promise<void> {
    await this.client.send('invite.send', { to, kind, body })
  }

  async revokeDevice(deviceKeyId: string): Promise<void> {
    await this.client.send('device.revoke', { deviceKeyId })
  }

  async releaseScope(routeId: string): Promise<void> {
    await this.client.send('scope.leave', { routeId })
  }
}

/**
 * Selects the Durable Objects transport when the deployment has flipped
 * `COORDINATION_BACKEND=durable-objects` (surfaced to the client via the
 * app's own runtime-config plumbing), otherwise `null` so the caller keeps
 * using its existing legacy-relay code path unchanged. Nothing above this
 * function should import `DurableObjectTransport` or `RealtimeClient`
 * directly — see docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 12.4.
 */
export function selectDurableObjectsTransport(
  backend: string | undefined,
  config: RealtimeClientConfig
): CoordinationTransport | null {
  return backend === 'durable-objects' ? new DurableObjectTransport(config) : null
}
