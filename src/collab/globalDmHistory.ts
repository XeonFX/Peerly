/**
 * Peerly global friend DM history — thin wrapper over @peerly/core text history.
 * Dual-reads legacy bare arrays via the core store.
 */

import {
  createTextChatHistoryStore,
  DEFAULT_HISTORY_CAP,
  type TextChatWire,
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
}

export function loadGlobalDmHistory(roomCode: string): GlobalDmMessage[] {
  return store.load(roomCode).wires as GlobalDmMessage[]
}

export function saveGlobalDmHistory(roomCode: string, messages: GlobalDmMessage[]): void {
  store.save(roomCode, messages)
}

export function upsertGlobalDmMessage(
  messages: GlobalDmMessage[],
  next: GlobalDmMessage
): GlobalDmMessage[] {
  return store.mergeMessages(messages, [next]) as GlobalDmMessage[]
}
