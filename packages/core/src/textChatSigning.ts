import { encodeCanonicalLines } from './canonical.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'

/**
 * Simple text-room chat wires. Peerly workspaces use a richer HistoryEntry
 * format in the app; both share encodeCanonicalLines and device-key
 * verification.
 *
 * Scheme strings are app-owned so wire formats stay stable across releases.
 */

export type TextChatWire = {
  id: string
  ts: number
  text: string
  name: string
  deviceKeyId: DeviceKeyId
  sig: string
  editedAt?: number
  deletedAt?: number
}

export type TextReactionWire = {
  messageId: string
  emoji: string
  active: boolean
  ts: number
  authorUserId: string
  deviceKeyId: DeviceKeyId
  sig: string
}

/** Minimal signer surface — DeviceIdentity satisfies this. */
export type DeviceSigner = {
  publicKeyId: () => Promise<DeviceKeyId>
  sign: (data: Uint8Array) => Promise<string>
}

export function textChatBytes(scheme: string, wire: Omit<TextChatWire, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    scheme,
    wire.id,
    String(wire.ts),
    wire.name,
    wire.deviceKeyId,
    String(wire.editedAt ?? ''),
    String(wire.deletedAt ?? ''),
    wire.text,
  ])
}

export function textReactionBytes(scheme: string, wire: Omit<TextReactionWire, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    scheme,
    wire.messageId,
    wire.emoji,
    String(wire.active),
    String(wire.ts),
    wire.authorUserId,
    wire.deviceKeyId,
  ])
}

export async function signTextChat(
  signer: DeviceSigner,
  scheme: string,
  fields: Omit<TextChatWire, 'sig' | 'deviceKeyId'>
): Promise<TextChatWire> {
  const deviceKeyId = await signer.publicKeyId()
  const body = { ...fields, deviceKeyId }
  const sig = await signer.sign(textChatBytes(scheme, body))
  return { ...body, sig }
}

export async function signTextReaction(
  signer: DeviceSigner,
  scheme: string,
  fields: Omit<TextReactionWire, 'sig' | 'deviceKeyId'>
): Promise<TextReactionWire> {
  const deviceKeyId = await signer.publicKeyId()
  const body = { ...fields, deviceKeyId }
  const sig = await signer.sign(textReactionBytes(scheme, body))
  return { ...body, sig }
}

export async function verifyTextChat(scheme: string, wire: TextChatWire): Promise<boolean> {
  if (typeof wire !== 'object' || !wire) return false
  if (typeof wire.id !== 'string' || !wire.id) return false
  if (typeof wire.ts !== 'number') return false
  if (typeof wire.text !== 'string' || wire.text.length > 4000) return false
  if (typeof wire.name !== 'string' || wire.name.length > 80) return false
  if (typeof wire.deviceKeyId !== 'string' || typeof wire.sig !== 'string') return false
  return verifyWithDeviceKeyId(wire.deviceKeyId, textChatBytes(scheme, wire), wire.sig)
}

export async function verifyTextReaction(
  scheme: string,
  wire: TextReactionWire
): Promise<boolean> {
  if (typeof wire !== 'object' || !wire) return false
  if (typeof wire.messageId !== 'string' || !wire.messageId) return false
  if (typeof wire.emoji !== 'string' || wire.emoji.length === 0 || wire.emoji.length > 16) {
    return false
  }
  if (typeof wire.active !== 'boolean' || typeof wire.ts !== 'number') return false
  if (typeof wire.authorUserId !== 'string' || typeof wire.deviceKeyId !== 'string') return false
  if (typeof wire.sig !== 'string') return false
  return verifyWithDeviceKeyId(wire.deviceKeyId, textReactionBytes(scheme, wire), wire.sig)
}

/** How many in-memory messages a peer rebroadcasts on history request. */
export const DEFAULT_HISTORY_CAP = 100
