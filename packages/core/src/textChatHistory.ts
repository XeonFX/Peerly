/**
 * Device-local signed text-chat history for simple rooms (global DMs, etc.).
 * Apps own the storage prefix and whether reactions / max-age apply.
 */

import { revisionScore } from './messageMerge.js'
import type { TextChatWire, TextReactionWire } from './textChatSigning.js'
import { DEFAULT_HISTORY_CAP } from './textChatSigning.js'

export type TextChatHistoryConfig = {
  /** localStorage key prefix; room code is appended. */
  storagePrefix: string
  messageCap?: number
  reactionCap?: number
  /** Drop whole store if savedAt older than this (0 = no age prune). */
  maxAgeMs?: number
}

export type StoredTextChatHistory = {
  v: 1 | 2
  savedAt: number
  wires: TextChatWire[]
  reactions?: TextReactionWire[]
}

export type TextChatHistoryEnvelope = {
  messages: TextChatWire[]
  reactions: TextReactionWire[]
}

export type TextChatHistoryStore = {
  storageKey: (roomCode: string) => string
  load: (roomCode: string) => { wires: TextChatWire[]; reactions: TextReactionWire[] }
  save: (roomCode: string, wires: TextChatWire[], reactions?: TextReactionWire[]) => void
  mergeMessages: (existing: TextChatWire[], incoming: TextChatWire[]) => TextChatWire[]
  mergeReactions: (existing: TextReactionWire[], incoming: TextReactionWire[]) => TextReactionWire[]
  parseEnvelope: (raw: unknown) => TextChatHistoryEnvelope
  messageCap: number
  reactionCap: number
}

function isChatWire(value: unknown): value is TextChatWire {
  if (typeof value !== 'object' || value === null) return false
  const w = value as Partial<TextChatWire>
  return (
    typeof w.id === 'string' &&
    typeof w.ts === 'number' &&
    typeof w.text === 'string' &&
    typeof w.name === 'string' &&
    typeof w.deviceKeyId === 'string' &&
    typeof w.sig === 'string'
  )
}

function isReactionWire(value: unknown): value is TextReactionWire {
  if (typeof value !== 'object' || value === null) return false
  const w = value as Partial<TextReactionWire>
  return (
    typeof w.messageId === 'string' &&
    typeof w.emoji === 'string' &&
    typeof w.active === 'boolean' &&
    typeof w.ts === 'number' &&
    typeof w.authorUserId === 'string' &&
    typeof w.deviceKeyId === 'string' &&
    typeof w.sig === 'string'
  )
}

/** Prefer higher revision (edit/delete), then newer ts on ties. */
export function mergeTextChatWires(
  existing: TextChatWire[],
  incoming: TextChatWire[],
  cap: number = DEFAULT_HISTORY_CAP
): TextChatWire[] {
  const byId = new Map<string, TextChatWire>()
  for (const wire of existing) {
    if (isChatWire(wire)) byId.set(wire.id, wire)
  }
  for (const wire of incoming) {
    if (!isChatWire(wire)) continue
    const prev = byId.get(wire.id)
    if (!prev) {
      byId.set(wire.id, wire)
      continue
    }
    const prevRev = Math.max(revisionScore(prev), prev.ts)
    const nextRev = Math.max(revisionScore(wire), wire.ts)
    if (nextRev >= prevRev) byId.set(wire.id, wire)
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-cap)
}

export function mergeTextReactionWires(
  existing: TextReactionWire[],
  incoming: TextReactionWire[],
  cap = 500
): TextReactionWire[] {
  const key = (r: TextReactionWire) => `${r.messageId}\0${r.authorUserId}\0${r.emoji}`
  const byKey = new Map<string, TextReactionWire>()
  for (const r of existing) {
    if (isReactionWire(r)) byKey.set(key(r), r)
  }
  for (const r of incoming) {
    if (!isReactionWire(r)) continue
    const k = key(r)
    const prev = byKey.get(k)
    if (!prev || r.ts >= prev.ts) byKey.set(k, r)
  }
  return [...byKey.values()].sort((a, b) => a.ts - b.ts).slice(-cap)
}

export function parseTextChatHistoryEnvelope(raw: unknown): TextChatHistoryEnvelope {
  if (Array.isArray(raw)) {
    return { messages: raw.filter(isChatWire), reactions: [] }
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Partial<TextChatHistoryEnvelope>
    return {
      messages: Array.isArray(obj.messages) ? obj.messages.filter(isChatWire) : [],
      reactions: Array.isArray(obj.reactions) ? obj.reactions.filter(isReactionWire) : [],
    }
  }
  return { messages: [], reactions: [] }
}

/**
 * Create a localStorage-backed history store for one app (prefix-owned).
 * Dual-reads legacy bare message arrays (Peerly GDM v0) into the v2 envelope.
 */
export function createTextChatHistoryStore(
  config: TextChatHistoryConfig
): TextChatHistoryStore {
  const messageCap = config.messageCap ?? DEFAULT_HISTORY_CAP
  const reactionCap = config.reactionCap ?? 500
  const maxAgeMs = config.maxAgeMs ?? 0
  const prefix = config.storagePrefix

  const storageKey = (roomCode: string) =>
    `${prefix}${roomCode.trim().toLowerCase()}`

  const load = (roomCode: string) => {
    if (!roomCode.trim()) return { wires: [] as TextChatWire[], reactions: [] as TextReactionWire[] }
    try {
      const raw = localStorage.getItem(storageKey(roomCode))
      if (!raw) return { wires: [], reactions: [] }
      const parsed = JSON.parse(raw) as unknown

      // Legacy Peerly GDM: bare message array.
      if (Array.isArray(parsed)) {
        return {
          wires: mergeTextChatWires([], parsed.filter(isChatWire), messageCap),
          reactions: [],
        }
      }

      if (typeof parsed !== 'object' || parsed === null) {
        return { wires: [], reactions: [] }
      }
      const store = parsed as Partial<StoredTextChatHistory>
      if ((store.v !== 1 && store.v !== 2) || !Array.isArray(store.wires)) {
        return { wires: [], reactions: [] }
      }
      const savedAt = typeof store.savedAt === 'number' ? store.savedAt : 0
      if (maxAgeMs > 0 && savedAt > 0 && Date.now() - savedAt > maxAgeMs) {
        return { wires: [], reactions: [] }
      }
      return {
        wires: mergeTextChatWires([], store.wires.filter(isChatWire), messageCap),
        reactions: mergeTextReactionWires(
          [],
          Array.isArray(store.reactions) ? store.reactions.filter(isReactionWire) : [],
          reactionCap
        ),
      }
    } catch {
      return { wires: [], reactions: [] }
    }
  }

  const save = (
    roomCode: string,
    wires: TextChatWire[],
    reactions: TextReactionWire[] = []
  ) => {
    if (!roomCode.trim()) return
    const signedWires = mergeTextChatWires([], wires, messageCap)
    const signedReactions = mergeTextReactionWires([], reactions, reactionCap)
    try {
      if (signedWires.length === 0 && signedReactions.length === 0) {
        localStorage.removeItem(storageKey(roomCode))
        return
      }
      const payload: StoredTextChatHistory = {
        v: 2,
        savedAt: Date.now(),
        wires: signedWires,
        reactions: signedReactions,
      }
      localStorage.setItem(storageKey(roomCode), JSON.stringify(payload))
    } catch {
      // quota / private mode
    }
  }

  return {
    storageKey,
    load,
    save,
    mergeMessages: (a, b) => mergeTextChatWires(a, b, messageCap),
    mergeReactions: (a, b) => mergeTextReactionWires(a, b, reactionCap),
    parseEnvelope: parseTextChatHistoryEnvelope,
    messageCap,
    reactionCap,
  }
}
