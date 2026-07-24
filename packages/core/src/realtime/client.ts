import { createKvStore, type KvStore } from '../kvStore.js'
import { CLIENT_LIMITS } from './limits.js'
import { decodeFrame, encodeCommand } from './protocol.js'
import type {
  DeviceSignerLike, OidcCredentialProvider, RealtimeDeltaEvent, TransportDiagnostics, TransportState,
} from './types.js'

export type RealtimeClientConfig = {
  app: string
  credentialProvider: OidcCredentialProvider
  fetchImpl?: typeof fetch
  WebSocketImpl?: typeof WebSocket
}

type PendingCommand = {
  id: string
  text: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const encodeProof = (purpose: string, app: string, deviceKeyId: string, timestamp: number, nonce: string, extra = '') =>
  new TextEncoder().encode([purpose, app, deviceKeyId, String(timestamp), nonce, extra].join('\n'))

async function deviceProofHeaders(signer: DeviceSignerLike, purpose: string, app: string, extra = ''): Promise<{ deviceKeyId: string; nonce: string; timestamp: number; signature: string }> {
  const deviceKeyId = await signer.publicKeyId()
  const timestamp = Date.now()
  const nonce = crypto.randomUUID()
  const signature = await signer.sign(encodeProof(purpose, app, deviceKeyId, timestamp, nonce, extra))
  return { deviceKeyId, nonce, timestamp, signature }
}

/**
 * Explicit connection state machine: offline -> enrolling -> session ->
 * connecting -> ready, with exponential-jitter backoff and resume-from-
 * last-ack. See docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 12.
 */
export class RealtimeClient extends EventTarget {
  private readonly config: RealtimeClientConfig
  private readonly store: KvStore<string | number>
  private ws: WebSocket | null = null
  private state: TransportState = 'offline'
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastAckSeq = 0
  private pending = new Map<string, PendingCommand>()
  private queue: PendingCommand[] = []
  private lastEventAt: number | null = null
  private stopped = false
  private connectPromise: Promise<void> | null = null
  private sessionTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: RealtimeClientConfig) {
    super()
    this.config = config
    // App-scoped: this class runs in both Peerly's and HeyHubs' browsers
    // (see docs/DURABLE_OBJECTS_IMPLEMENTATION.md section 12.2), so a fixed
    // 'peerly-realtime' name would put HeyHubs' capability/resume state in a
    // database literally named after the other product.
    this.store = createKvStore<string | number>(`${config.app}-realtime`, 'state')
  }

  get diagnostics(): TransportDiagnostics {
    return {
      state: this.state,
      reconnectCount: this.reconnectAttempt,
      lastEventAt: this.lastEventAt,
      degraded: this.state !== 'ready',
    }
  }

  private setState(state: TransportState) {
    this.state = state
    this.dispatchEvent(new CustomEvent('state', { detail: state }))
  }

  async connect(): Promise<void> {
    if (this.state === 'ready') return
    if (this.connectPromise) return this.connectPromise
    this.stopped = false
    this.connectPromise = this.runConnectCycle().finally(() => {
      this.connectPromise = null
    })
    await this.connectPromise
  }

  close(): void {
    this.stopped = true
    this.stopTimers()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close(1000, 'client closing')
    // Fail in-flight commands immediately rather than leaving their promises
    // unsettled for up to commandTimeoutMs after an explicit, intentional
    // shutdown — the eventual timeout rejection bounds the wait either way,
    // but a caller awaiting send() around a close() should not have to wait
    // out that whole window for an answer that will never come.
    for (const command of [...this.pending.values(), ...this.queue]) this.settle(command, 'reject', new Error('client-closed'))
    this.setState('offline')
  }

  private async runConnectCycle(): Promise<void> {
    if (this.stopped) return
    try {
      const capability = await this.ensureCapability()
      this.setState('session')
      const { turn } = await this.establishSession(capability)
      this.setState('connecting')
      await this.openSocket()
      this.reconnectAttempt = 0
      this.setState('ready')
      this.dispatchEvent(new CustomEvent('turn', { detail: turn }))
      this.startTimers()
    } catch (error) {
      if (error instanceof Error && error.message === 'upgrade-required') {
        this.setState('upgrade-required')
        return
      }
      this.scheduleReconnect()
    }
  }

  /**
   * Keep the two things that expire on a wall clock rather than on socket
   * lifetime alive for as long as this socket is: the `pnet` cookie (which
   * every later signal-socket upgrade is authenticated with) and the TURN
   * credential. Both come from the same `/api/network/session` response, so
   * one periodic re-establish refreshes both; each success re-dispatches
   * `turn` so consumers replace the credentials they cached.
   */
  private startTimers(): void {
    this.stopTimers()
    this.sessionTimer = setInterval(() => {
      if (this.stopped || this.ws?.readyState !== 1) return
      void (async () => {
        try {
          const capability = await this.ensureCapability()
          const { turn } = await this.establishSession(capability)
          this.dispatchEvent(new CustomEvent('turn', { detail: turn }))
        } catch {
          // The socket is still up and still authenticated; the next attempt
          // (or a reconnect) refreshes. Never tear down a healthy socket for
          // a failed refresh.
        }
      })()
    }, CLIENT_LIMITS.sessionRefreshMs)
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === 1) this.ws.send('ping')
    }, CLIENT_LIMITS.pingIntervalMs)
  }

  private stopTimers(): void {
    if (this.sessionTimer) clearInterval(this.sessionTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.sessionTimer = null
    this.pingTimer = null
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.stopTimers()
    this.setState('backoff')
    const attempt = this.reconnectAttempt
    this.reconnectAttempt += 1
    const cap = Math.min(CLIENT_LIMITS.reconnectCapMs, CLIENT_LIMITS.reconnectBaseMs * 2 ** attempt)
    const delay = Math.random() * cap
    this.reconnectTimer = setTimeout(() => { void this.runConnectCycle() }, delay)
  }

  private async ensureCapability(): Promise<string> {
    const cached = await this.store.get('capability')
    // A prior 401 clears this to '' (see establishSession) rather than
    // deleting it — KvStore has no delete — so a truthy check here is load
    // bearing: `typeof cached === 'string'` alone treats that cleared marker
    // as a real capability and resends it forever, since the server always
    // 400s an empty capability rather than 401ing it back into a re-enroll.
    if (typeof cached === 'string' && cached) return cached
    this.setState('enrolling')
    const fetchImpl = this.config.fetchImpl ?? fetch
    const auth = await this.config.credentialProvider()
    if (!auth) throw new Error('no credential available')
    const proof = await deviceProofHeaders(auth.signer, 'realtime-enroll-v1', this.config.app)
    const response = await fetchImpl('/api/network/enroll', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-peerly-device-key': proof.deviceKeyId,
        'x-peerly-request-ts': String(proof.timestamp),
        'x-peerly-request-nonce': proof.nonce,
        'x-peerly-request-signature': proof.signature,
      },
      body: JSON.stringify({ provider: auth.providerId, token: auth.token }),
    })
    if (response.status === 409) throw new Error('enroll-conflict')
    if (!response.ok) throw new Error('enroll-failed')
    const body = await response.json() as { capability: string }
    await this.store.set('capability', body.capability)
    return body.capability
  }

  private async establishSession(capability: string): Promise<{ turn?: unknown }> {
    const fetchImpl = this.config.fetchImpl ?? fetch
    const auth = await this.config.credentialProvider()
    if (!auth) throw new Error('no credential available')
    const proof = await deviceProofHeaders(auth.signer, 'realtime-session-v1', this.config.app)
    const response = await fetchImpl('/api/network/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-peerly-device-key': proof.deviceKeyId,
        'x-peerly-request-ts': String(proof.timestamp),
        'x-peerly-request-nonce': proof.nonce,
        'x-peerly-request-signature': proof.signature,
      },
      body: JSON.stringify({ capability }),
    })
    if (response.status === 401) {
      await this.store.set('capability', '')
      throw new Error('session-failed')
    }
    if (!response.ok) throw new Error('session-failed')
    return response.json() as Promise<{ turn?: unknown }>
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const WS = this.config.WebSocketImpl ?? WebSocket
      const url = new URL('/api/realtime/control', location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WS(url.toString())
      this.ws = ws
      let opened = false
      ws.addEventListener('open', () => {
        opened = true
        ws.send(encodeCommand('hello', { version: CLIENT_LIMITS.protocolVersion, resumeSeq: this.lastAckSeq }).text)
        const queued = this.queue.splice(0, this.queue.length)
        for (const command of queued) {
          this.pending.set(command.id, command)
          ws.send(command.text)
        }
        resolve()
      })
      ws.addEventListener('message', event => this.handleMessage(String(event.data)))
      ws.addEventListener('close', event => {
        this.ws = null
        this.stopTimers()
        for (const command of this.pending.values()) this.queue.unshift(command)
        this.pending.clear()
        if (event.code === 4002) reject(new Error('upgrade-required'))
        else if (!opened) reject(new Error('socket-failed'))
        else if (!this.stopped) this.scheduleReconnect()
      })
      ws.addEventListener('error', () => { if (!opened) reject(new Error('socket-failed')) })
    })
  }

  /** Clear a command's timeout timer and remove it from pending/queue, then resolve or reject it. */
  private settle(command: PendingCommand, outcome: 'resolve' | 'reject', value: unknown): void {
    clearTimeout(command.timer)
    this.pending.delete(command.id)
    const queued = this.queue.indexOf(command)
    if (queued !== -1) this.queue.splice(queued, 1)
    if (outcome === 'resolve') command.resolve(value)
    else command.reject(value as Error)
  }

  private handleMessage(raw: string): void {
    if (raw === 'pong') return
    const frame = decodeFrame(raw)
    if (!frame) return
    this.lastEventAt = Date.now()
    if (frame.type === 'ack' || frame.type === 'error') {
      const payload = frame.payload as { for?: string } | undefined
      const forId = payload?.for
      const command = forId ? this.pending.get(forId) : undefined
      if (command) {
        if (frame.type === 'ack') this.settle(command, 'resolve', (payload as { result?: unknown }).result)
        else this.settle(command, 'reject', new Error(JSON.stringify(payload)))
      }
      return
    }
    if (frame.type === 'delta') {
      const payload = frame.payload as { events: RealtimeDeltaEvent[]; seq: number }
      this.lastAckSeq = payload.seq
      for (const event of payload.events) this.dispatchEvent(new CustomEvent(event.kind, { detail: event.body }))
      return
    }
    if (frame.type === 'snapshot') {
      this.dispatchEvent(new CustomEvent('snapshot', { detail: frame.payload }))
    }
  }

  /**
   * Send a command and resolve with its ack payload; rejects on an `error`
   * frame or after CLIENT_LIMITS.commandTimeoutMs with no ack/error — a lost
   * ack (e.g. the DO drops the socket without acking) must not leave the
   * promise, and its entry in `pending`/`queue`, hanging forever. The
   * deadline covers the command's whole lifetime including any reconnect:
   * it is not reset when a command is requeued after a socket close.
   */
  send<T = unknown>(type: string, payload?: unknown, scope?: string): Promise<T> {
    const { id, text } = encodeCommand(type, payload, scope)
    return new Promise<T>((resolve, reject) => {
      const command: PendingCommand = {
        id, text, resolve: resolve as (value: unknown) => void, reject,
        timer: setTimeout(() => this.settle(command, 'reject', new Error('timeout')), CLIENT_LIMITS.commandTimeoutMs),
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.pending.set(id, command)
        this.ws.send(text)
      } else {
        if (this.queue.length >= CLIENT_LIMITS.commandQueueMax) {
          clearTimeout(command.timer)
          return reject(new Error('queue-full'))
        }
        this.queue.push(command)
      }
    })
  }
}
