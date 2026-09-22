/**
 * What the browser control client needs from its environment.
 *
 * The previous client reached straight for `fetch`, `WebSocket`, `location`
 * and IndexedDB, which is why it had no tests at all — and why an enrolment
 * loop, a session-refresh gap and a resume bug all shipped. Behind these
 * ports the whole state machine runs against fakes.
 */

/** Seconds the server asked us to wait, when it said so. A control plane that
 *  is over quota or overloaded answers 503/429 with `Retry-After`; honouring it
 *  is what stops every client retrying into the same wall at its own pace. */
type Backoff = { readonly retryAfterMs?: number }

export type EnrollResult =
  | { readonly kind: 'capability'; readonly capability: string }
  | { readonly kind: 'conflict' }
  | ({ readonly kind: 'failed' } & Backoff)

export type SessionResult =
  | { readonly kind: 'established'; readonly turn?: unknown }
  /** The capability is no longer good; it must be discarded, not retried. */
  | { readonly kind: 'rejected' }
  | ({ readonly kind: 'failed' } & Backoff)

export interface SessionApi {
  enroll(): Promise<EnrollResult>
  establish(capability: string): Promise<SessionResult>
}

export interface ControlChannel {
  send(frame: string): void
  close(): void
  readonly open: boolean
}

export type ChannelEvents = {
  onOpen(): void
  onFrame(raw: string): void
  /** `code` is the close code, so the terminal 4002 path is reachable. */
  onClose(code: number): void
  onError(): void
}

export interface ChannelFactory {
  connect(events: ChannelEvents): ControlChannel
}

/** Small persisted values: the capability and the resume cursor. */
export interface KeyValueStore {
  get(key: string): Promise<string | number | undefined>
  set(key: string, value: string | number): Promise<void>
}

export interface Timers {
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(handle: number): void
  setInterval(handler: () => void, ms: number): number
  clearInterval(handle: number): void
}
