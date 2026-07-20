/**
 * Peerly global friend DM history — thin wrapper over @peerly/core text history.
 * Dual-reads legacy bare arrays via the core store.
 */

import {
  createTextChatHistoryStore,
  DEFAULT_HISTORY_CAP,
  type TextChatWire,
  type TextReactionWire,
} from '@peerly/core'

const store = createTextChatHistoryStore({
  storagePrefix: 'peerly-gdm-hist-v1-',
  messageCap: DEFAULT_HISTORY_CAP,
  maxAgeMs: 90 * 24 * 60 * 60 * 1000,
})

export const GLOBAL_DM_HISTORY_CAP = store.messageCap

export type GlobalDmMessage = TextChatWire & {
  /** Durable OIDC user id of the author when known. */
  authorUserId?: string
  deviceGrant?: import('./deviceAuthorization').DeviceGrant
}

export type GlobalDmReaction = TextReactionWire & {
  deviceGrant?: import('./deviceAuthorization').DeviceGrant
}

export function loadGlobalDmHistory(roomCode: string): GlobalDmMessage[] {
  return store.load(roomCode).wires as GlobalDmMessage[]
}

export function loadGlobalDmReactions(roomCode: string): GlobalDmReaction[] {
  return store.load(roomCode).reactions as GlobalDmReaction[]
}

export function saveGlobalDmHistory(
  roomCode: string,
  messages: GlobalDmMessage[],
  reactions: GlobalDmReaction[] = []
): void {
  store.save(roomCode, messages, reactions)
}

export function mergeGlobalDmReactions(
  current: GlobalDmReaction[],
  incoming: GlobalDmReaction[]
): GlobalDmReaction[] {
  return store.mergeReactions(current, incoming) as GlobalDmReaction[]
}

export function upsertGlobalDmMessage(
  messages: GlobalDmMessage[],
  next: GlobalDmMessage
): GlobalDmMessage[] {
  return store.mergeMessages(messages, [next]) as GlobalDmMessage[]
}
