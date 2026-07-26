/**
 * The command registry.
 *
 * The previous design put every command in one closed `switch` inside the
 * shared gateway, which is how one app's matchmaking and room-directory
 * commands ended up in core — and deployed, inert, inside the other app.
 * Here core declares only what is universal, and an app extends the registry
 * with its own commands and their validators.
 *
 * A registry entry owns its payload validation, so "add a command" is one
 * entry beside its handler rather than an edit to shared code in another
 * repository.
 */
import { LIMITS } from './limits.js'
import {
  boundedArray, boundedString, byteLength, FrameError, isPlainObject,
} from './frames.js'
import { asDeviceKeyId, asMemberId, type DeviceKeyId, type MemberId } from './ids.js'

/**
 * `validate` returns the parsed payload or throws `FrameError`. Returning a
 * *typed* value rather than a boolean is what lets a handler receive
 * `SeekRequest` instead of `unknown` and stop re-checking what the validator
 * already proved.
 */
export type CommandSpec<Payload> = {
  readonly type: string
  validate(payload: unknown): Payload
}

export function defineCommand<Payload>(
  type: string,
  validate: (payload: unknown) => Payload
): CommandSpec<Payload> {
  return { type, validate }
}

/**
 * A function declaration, not an arrow constant: TypeScript only narrows past
 * a call when the callee's `never` return is visible at the call site, which
 * it is for a declaration and is not for a `const` without an explicit type.
 * That difference is what lets the validators below read a field once and have
 * it narrowed for the return.
 */
function fail(type: string): never {
  throw new FrameError(`malformed payload for ${type}`)
}

// ---- universal commands ----------------------------------------------------

export type HelloPayload = { version: number; resumeSeq?: number }

export const helloCommand = defineCommand<HelloPayload>('hello', payload => {
  if (!isPlainObject(payload) || typeof payload.version !== 'number') fail('hello')
  const value = payload as Record<string, unknown>
  if (value.resumeSeq !== undefined && typeof value.resumeSeq !== 'number') fail('hello')
  return {
    version: value.version as number,
    ...(typeof value.resumeSeq === 'number' ? { resumeSeq: value.resumeSeq } : {}),
  }
})

export type ResumePayload = { fromSeq: number }

export const resumeCommand = defineCommand<ResumePayload>('resume', payload => {
  if (!isPlainObject(payload) || typeof payload.fromSeq !== 'number') fail('resume')
  return { fromSeq: (payload as { fromSeq: number }).fromSeq }
})

export const SCOPE_KINDS = ['workspace', 'dm', 'room', 'chat'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]
export type ScopeRequestPayload = { kind: ScopeKind; capability: string }

export const scopeRequestCommand = defineCommand<ScopeRequestPayload>('scope.request', payload => {
  if (!isPlainObject(payload)) fail('scope.request')
  const value = payload as Record<string, unknown>
  if (!SCOPE_KINDS.includes(value.kind as ScopeKind)) fail('scope.request')
  if (!boundedString(value.capability, 256)) fail('scope.request')
  return { kind: value.kind as ScopeKind, capability: value.capability }
})

export type ScopeLeavePayload = { routeId: string }

export const scopeLeaveCommand = defineCommand<ScopeLeavePayload>('scope.leave', payload => {
  if (!isPlainObject(payload) || !boundedString(payload.routeId, 128)) fail('scope.leave')
  return { routeId: (payload as { routeId: string }).routeId }
})

export type InviteSendPayload = { to: string; kind: string; body: Record<string, unknown> }

export const inviteSendCommand = defineCommand<InviteSendPayload>('invite.send', payload => {
  if (!isPlainObject(payload)) fail('invite.send')
  const value = payload as Record<string, unknown>
  if (!boundedString(value.to, 128) || !boundedString(value.kind, 40)) fail('invite.send')
  if (!isPlainObject(value.body) || byteLength(JSON.stringify(value.body)) > 4096) fail('invite.send')
  return { to: value.to, kind: value.kind, body: value.body }
})

export type InviteAckPayload = { inviteId: string }

export const inviteAckCommand = defineCommand<InviteAckPayload>('invite.ack', payload => {
  if (!isPlainObject(payload) || !boundedString(payload.inviteId, 64)) fail('invite.ack')
  return { inviteId: (payload as { inviteId: string }).inviteId }
})

export type RingSendPayload = { to: string; roomRoute: string }

export const ringSendCommand = defineCommand<RingSendPayload>('ring.send', payload => {
  if (!isPlainObject(payload)) fail('ring.send')
  const value = payload as Record<string, unknown>
  if (!boundedString(value.to, 128) || !boundedString(value.roomRoute, 128)) fail('ring.send')
  return { to: value.to, roomRoute: value.roomRoute }
})

export type DeviceRevokePayload = { deviceKeyId: DeviceKeyId }

/** The account is the socket's own identity and never a parameter, so this
 *  can only ever reach the caller's own devices. */
export const deviceRevokeCommand = defineCommand<DeviceRevokePayload>('device.revoke', payload => {
  if (!isPlainObject(payload)) fail('device.revoke')
  const deviceKeyId = asDeviceKeyId((payload as { deviceKeyId: unknown }).deviceKeyId)
  if (!deviceKeyId) fail('device.revoke')
  return { deviceKeyId: deviceKeyId as DeviceKeyId }
})

// ---- registry --------------------------------------------------------------

export class CommandRegistry {
  private readonly specs: Map<string, CommandSpec<unknown>>

  private constructor(specs: Map<string, CommandSpec<unknown>>) {
    this.specs = specs
  }

  static of(specs: readonly CommandSpec<never>[]): CommandRegistry {
    const map = new Map<string, CommandSpec<unknown>>()
    for (const spec of specs) map.set(spec.type, spec as CommandSpec<unknown>)
    return new CommandRegistry(map)
  }

  /** Returns a new registry; registries are never mutated after construction
   *  so a composition root cannot be surprised by a late registration. */
  extend(specs: readonly CommandSpec<never>[]): CommandRegistry {
    const map = new Map(this.specs)
    for (const spec of specs) {
      if (map.has(spec.type)) throw new Error(`duplicate command type: ${spec.type}`)
      map.set(spec.type, spec as CommandSpec<unknown>)
    }
    return new CommandRegistry(map)
  }

  has(type: string): boolean {
    return this.specs.has(type)
  }

  get types(): readonly string[] {
    return [...this.specs.keys()]
  }

  /** Throws `FrameError` for an unknown type or a bad payload — the caller
   *  answers with an error frame; it never has to guess which. */
  validate(type: string, payload: unknown): unknown {
    const spec = this.specs.get(type)
    if (!spec) throw new FrameError(`unknown command: ${type}`, { code: 'not-found' })
    return spec.validate(payload)
  }
}

/** Commands meaningful to any app built on this control plane. Matchmaking
 *  and room-directory commands are deliberately absent: they belong to the
 *  app that has them. */
export function coreCommands(): CommandRegistry {
  return CommandRegistry.of([
    helloCommand, resumeCommand,
    scopeRequestCommand, scopeLeaveCommand,
    inviteSendCommand, inviteAckCommand, ringSendCommand,
    deviceRevokeCommand,
  ] as unknown as CommandSpec<never>[])
}

// ---- signal socket ---------------------------------------------------------

export type SignalPayload = {
  topic?: string
  to?: string
  subscribe?: string[]
  message?: unknown
}

/**
 * The one frame a signal socket accepts. The scope forwards `message`
 * opaquely and reads only routing fields, so this validates the envelope
 * around the payload and never the SDP/ICE inside it.
 */
export const signalCommand = defineCommand<SignalPayload>('signal', payload => {
  if (!isPlainObject(payload)) fail('signal')
  const value = payload as Record<string, unknown>
  if (value.to !== undefined && !boundedString(value.to, 128)) fail('signal')
  if (value.topic !== undefined && !boundedString(value.topic, 256)) fail('signal')
  if (value.subscribe !== undefined &&
    !boundedArray(value.subscribe, LIMITS.topicsPerParticipant, (entry): entry is string =>
      boundedString(entry, 256))) fail('signal')
  return value as SignalPayload
})

// ---- shared value objects --------------------------------------------------

export type SeekInterests = readonly string[] & { readonly __nonEmpty: unique symbol }

/**
 * Normalize and bound a raw interest list.
 *
 * Returns `null` for an empty result rather than an empty array, so a seek
 * with no interests has no representation: the previous implementation wrote
 * a seek row, enqueued into nothing, and left the user seeking forever in no
 * queue, invisible to the availability count and matching nobody.
 *
 * Normalization runs before the length check because NFKC can *expand* a
 * string past a cap that was already verified upstream.
 */
export function normalizeInterests(raw: readonly unknown[]): readonly string[] | null {
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase().normalize('NFKC')
    if (!normalized || normalized.length > LIMITS.interestMaxChars) continue
    seen.add(normalized)
    if (seen.size >= LIMITS.interestsPerSeek) break
  }
  return seen.size > 0 ? [...seen] : null
}

/** Exclusions live in the app's `MemberId` space, never the server's opaque
 *  id space — comparing the two is what silently disabled every blocklist. */
export function normalizeExclusions(raw: unknown): MemberId[] {
  if (!Array.isArray(raw)) return []
  const out: MemberId[] = []
  for (const value of raw) {
    const memberId = asMemberId(value)
    if (memberId) out.push(memberId)
    if (out.length >= LIMITS.exclusionsPerSeek) break
  }
  return out
}
