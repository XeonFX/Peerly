/**
 * The browser control client: an explicit state machine over ports.
 *
 * offline → enrolling → session → connecting → ready, with backoff, resume
 * from the last acknowledged sequence, and a periodic session refresh.
 *
 * Every failure this file has caused in production is now a named case with a
 * test: an enrolment loop from a cleared capability that still read as a
 * string, a session refresh that never happened so the cookie and the TURN
 * credential expired under a live socket, and a resume cursor that lived only
 * in memory so every page load replayed the retained stream.
 */
import { CLIENT_TIMINGS, LIMITS } from '../protocol/limits.js'
import { CLOSE, decodeFrame, encodeFrame } from '../protocol/frames.js'
import { createIdSource, type IdSource } from '../protocol/ids.js'
import type {
  ChannelFactory, ControlChannel, KeyValueStore, SessionApi, Timers,
} from '../ports/client.js'

export type ClientState =
  | 'offline' | 'enrolling' | 'session' | 'connecting' | 'ready' | 'backoff' | 'upgrade-required'

const CAPABILITY_KEY = 'capability'
const RESUME_KEY = 'resumeSeq'

type Pending = {
  readonly id: string
  readonly text: string
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  timer: number
}

export type RealtimeClientOptions = {
  readonly api: SessionApi
  readonly channels: ChannelFactory
  readonly store: KeyValueStore
  readonly timers: Timers
  readonly ids?: IdSource
  readonly random?: () => number
}

export class RealtimeClient extends EventTarget {
  private readonly options: RealtimeClientOptions
  private readonly ids: IdSource
  private channel: ControlChannel | null = null
  private state: ClientState = 'offline'
  private attempt = 0
  private reconnectTimer: number | null = null
  private sessionTimer: number | null = null
  private pingTimer: number | null = null
  private resumeTimer: number | null = null
  private lastAckSeq = 0
  private resumeLoaded = false
  private readonly pending = new Map<string, Pending>()
  private queue: Pending[] = []
  private stopped = false
  private connecting: Promise<void> | null = null

  constructor(options: RealtimeClientOptions) {
    super()
    this.options = options
    this.ids = options.ids ?? createIdSource()
  }

  get currentState(): ClientState {
    return this.state
  }

  async connect(): Promise<void> {
    if (this.state === 'ready') return
    if (this.connecting) return this.connecting
    this.stopped = false
    this.connecting = this.runCycle().finally(() => { this.connecting = null })
    await this.connecting
  }

  close(): void {
    this.stopped = true
    this.stopTimers()
    if (this.reconnectTimer !== null) this.options.timers.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.channel?.close()
    this.channel = null
    // Settle in-flight work immediately. Leaving these to time out means a
    // caller awaiting send() around close() waits the whole window for an
    // answer that can never arrive.
    for (const command of [...this.pending.values(), ...this.queue]) {
      this.settle(command, 'reject', new Error('client-closed'))
    }
    this.setState('offline')
  }

  send<T = unknown>(type: string, payload?: unknown, scope?: string): Promise<T> {
    const id = this.ids.next()
    const text = encodeFrame(type, { id, ...(scope ? { scope } : {}), ...(payload !== undefined ? { payload } : {}) })
    return new Promise<T>((resolve, reject) => {
      const command: Pending = {
        id, text,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: this.options.timers.setTimeout(
          () => this.settle(command, 'reject', new Error('timeout')),
          CLIENT_TIMINGS.commandTimeoutMs
        ),
      }
      if (this.channel?.open) {
        this.pending.set(id, command)
        this.channel.send(text)
        return
      }
      if (this.queue.length >= CLIENT_TIMINGS.commandQueueMax) {
        this.options.timers.clearTimeout(command.timer)
        reject(new Error('queue-full'))
        return
      }
      this.queue.push(command)
    })
  }

  // ---- connection cycle ----------------------------------------------------

  private async runCycle(): Promise<void> {
    if (this.stopped) return
    try {
      const capability = await this.ensureCapability()
      this.setState('session')
      const session = await this.options.api.establish(capability)
      if (session.kind === 'rejected') {
        // Discard rather than retry: the server 400s an empty capability, so a
        // client that keeps resending one loops forever instead of re-enrolling.
        await this.options.store.set(CAPABILITY_KEY, '')
        throw new Error('session-rejected')
      }
      if (session.kind === 'failed') throw new Error('session-failed')

      this.setState('connecting')
      await this.loadResumeCursor()
      await this.openChannel()
      this.attempt = 0
      this.setState('ready')
      this.dispatchEvent(new CustomEvent('turn', { detail: session.turn }))
      this.startTimers()
    } catch (error) {
      if (error instanceof Error && error.message === 'upgrade-required') {
        this.setState('upgrade-required')
        return
      }
      this.scheduleReconnect()
    }
  }

  private async ensureCapability(): Promise<string> {
    const cached = await this.options.store.get(CAPABILITY_KEY)
    // The truthiness check is load bearing. A rejected capability is cleared
    // to '' (the store has no delete), which is still a string — treating that
    // as usable resends it forever.
    if (typeof cached === 'string' && cached) return cached

    this.setState('enrolling')
    const result = await this.options.api.enroll()
    if (result.kind !== 'capability') throw new Error(`enroll-${result.kind}`)
    await this.options.store.set(CAPABILITY_KEY, result.capability)
    return result.capability
  }

  private openChannel(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let opened = false
      const channel = this.options.channels.connect({
        onOpen: () => {
          opened = true
          channel.send(encodeFrame('hello', {
            id: this.ids.next(),
            payload: { version: LIMITS.protocolVersion, resumeSeq: this.lastAckSeq },
          }))
          for (const command of this.queue.splice(0, this.queue.length)) {
            this.pending.set(command.id, command)
            channel.send(command.text)
          }
          resolve()
        },
        onFrame: raw => this.handleFrame(raw),
        onClose: code => {
          this.channel = null
          this.stopTimers()
          // Requeue rather than fail: the command has not been answered, and
          // its own deadline still bounds how long it can wait.
          for (const command of this.pending.values()) this.queue.unshift(command)
          this.pending.clear()
          if (code === CLOSE.VERSION_UNSUPPORTED) {
            // Terminal, and it must be applied directly rather than by
            // rejecting: the server can close 4002 at any point, and once the
            // open handshake has resolved a rejection is a no-op — which left
            // the client sitting in `ready` with no socket and no reconnect.
            this.stopped = true
            this.setState('upgrade-required')
            reject(new Error('upgrade-required'))
          } else if (!opened) reject(new Error('socket-failed'))
          else if (!this.stopped) this.scheduleReconnect()
        },
        onError: () => { if (!opened) reject(new Error('socket-failed')) },
      })
      this.channel = channel
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.stopTimers()
    this.setState('backoff')
    const attempt = this.attempt
    this.attempt += 1
    const cap = Math.min(CLIENT_TIMINGS.reconnectCapMs, CLIENT_TIMINGS.reconnectBaseMs * 2 ** attempt)
    const random = this.options.random ?? Math.random
    this.reconnectTimer = this.options.timers.setTimeout(() => { void this.runCycle() }, random() * cap)
  }

  // ---- periodic work -------------------------------------------------------

  /**
   * The session and the TURN credential both expire on a wall clock, not on
   * socket lifetime. Without this refresh a tab connected past the cookie TTL
   * could no longer open a signalling socket, and offered peers credentials
   * the TURN server had already expired.
   */
  private startTimers(): void {
    this.stopTimers()
    this.sessionTimer = this.options.timers.setInterval(() => {
      if (this.stopped || !this.channel?.open) return
      void (async () => {
        try {
          const capability = await this.ensureCapability()
          const session = await this.options.api.establish(capability)
          if (session.kind === 'established') {
            this.dispatchEvent(new CustomEvent('turn', { detail: session.turn }))
          }
        } catch {
          // A healthy socket is never torn down for a failed refresh; the next
          // interval, or a reconnect, will retry.
        }
      })()
    }, CLIENT_TIMINGS.sessionRefreshMs)

    this.pingTimer = this.options.timers.setInterval(() => {
      // Answered by the server's auto-response without waking the object.
      if (this.channel?.open) this.channel.send('ping')
    }, CLIENT_TIMINGS.pingIntervalMs)
  }

  private stopTimers(): void {
    const { timers } = this.options
    if (this.sessionTimer !== null) timers.clearInterval(this.sessionTimer)
    if (this.pingTimer !== null) timers.clearInterval(this.pingTimer)
    this.sessionTimer = null
    this.pingTimer = null
    if (this.resumeTimer !== null) {
      timers.clearTimeout(this.resumeTimer)
      this.resumeTimer = null
      void this.options.store.set(RESUME_KEY, this.lastAckSeq).catch(() => {})
    }
  }

  private async loadResumeCursor(): Promise<void> {
    if (this.resumeLoaded) return
    this.resumeLoaded = true
    const stored = await this.options.store.get(RESUME_KEY)
    if (typeof stored === 'number' && stored > this.lastAckSeq) this.lastAckSeq = stored
  }

  private saveResumeCursor(): void {
    if (this.resumeTimer !== null) return
    this.resumeTimer = this.options.timers.setTimeout(() => {
      this.resumeTimer = null
      void this.options.store.set(RESUME_KEY, this.lastAckSeq).catch(() => {})
    }, CLIENT_TIMINGS.resumeSaveDebounceMs)
  }

  // ---- inbound -------------------------------------------------------------

  private handleFrame(raw: string): void {
    if (raw === 'pong') return
    const frame = decodeFrame(raw)
    if (!frame) return

    if (frame.type === 'ack' || frame.type === 'error') {
      const payload = frame.payload as { for?: string; result?: unknown } | undefined
      const command = payload?.for ? this.pending.get(payload.for) : undefined
      if (!command) return
      if (frame.type === 'ack') this.settle(command, 'resolve', payload?.result)
      else this.settle(command, 'reject', new Error(JSON.stringify(payload)))
      return
    }

    if (frame.type === 'delta') {
      const payload = frame.payload as { events: { kind: string; body: unknown }[]; seq: number }
      this.lastAckSeq = payload.seq
      this.saveResumeCursor()
      for (const event of payload.events) {
        this.dispatchEvent(new CustomEvent(event.kind, { detail: event.body }))
      }
      return
    }

    if (frame.type === 'snapshot' || frame.type === 'bye') {
      this.dispatchEvent(new CustomEvent(frame.type, { detail: frame.payload }))
    }
  }

  private settle(command: Pending, outcome: 'resolve' | 'reject', value: unknown): void {
    this.options.timers.clearTimeout(command.timer)
    this.pending.delete(command.id)
    const queued = this.queue.indexOf(command)
    if (queued !== -1) this.queue.splice(queued, 1)
    if (outcome === 'resolve') command.resolve(value)
    else command.reject(value as Error)
  }

  private setState(state: ClientState): void {
    this.state = state
    this.dispatchEvent(new CustomEvent('state', { detail: state }))
  }
}
