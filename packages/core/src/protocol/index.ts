/**
 * The realtime wire contract: limits, identifiers, frames, and the command
 * registry. Pure — no platform globals beyond `crypto` and `TextEncoder` — so
 * it is imported unchanged by the browser client and the Worker, and every
 * rule in it is unit testable without a Durable Object or a socket.
 */
export { CLIENT_TIMINGS, LIMITS, type Limits } from './limits.js'
export {
  asDeviceKeyId, asMemberId, asOpaqueUserId, asRouteId,
  createIdSource, isValidFrameId,
  type DeviceKeyId, type IdSource, type MemberId, type OpaqueUserId, type RouteId,
} from './ids.js'
export {
  boundedArray, boundedString, byteLength, CLOSE, decodeFrame, encodeAck, encodeBye,
  encodeDelta, encodeError, encodeFrame, encodeSnapshot, ERROR_CODES, FrameError,
  isPlainObject, parseEnvelope,
  type CloseCode, type Envelope, type ErrorCode,
} from './frames.js'
export {
  CommandRegistry, coreCommands, defineCommand,
  deviceRevokeCommand, helloCommand, inviteAckCommand, inviteSendCommand,
  normalizeExclusions, normalizeInterests, resumeCommand, ringSendCommand,
  scopeLeaveCommand, scopeRequestCommand, signalCommand, SCOPE_KINDS,
  type CommandSpec, type DeviceRevokePayload, type HelloPayload, type InviteAckPayload,
  type InviteSendPayload, type ResumePayload, type RingSendPayload, type ScopeKind,
  type ScopeLeavePayload, type ScopeRequestPayload, type SignalPayload,
} from './commands.js'
