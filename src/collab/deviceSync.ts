/**
 * What this app copies onto a newly paired device.
 *
 * The engine lives in `@peerly/core`; what is app-owned is this list — which
 * keys sync at all, and how each merges with what the receiving device already
 * has.
 *
 * This used to be a deny-list: everything under the app's storage prefix
 * except a handful of named exceptions. That meant every key any future
 * feature invented synced by default, and per-device values like this
 * browser's own peer ids were being copied between machines. The list below is
 * the same set minus those, stated explicitly, and nothing new joins it by
 * accident.
 *
 * Deliberately absent, and worth keeping absent: the session and its id-token
 * claims, device grants and their labels, the sync secret itself, and the
 * legal-consent record — consent is given on a device, by a person, and is not
 * something another device gets to assert on their behalf.
 */
import { createDeviceSync, type ArrayMergeRule, type MergeRule } from '@peerly/core'
import { APP_STORAGE_SCOPE } from '../config'

export type { DeviceSyncSnapshot } from '@peerly/core'

type Item = Record<string, unknown>

const number = (item: Item, ...fields: string[]): number =>
  Math.max(...fields.map(field => Number(item[field] ?? 0)))

/** Anything the user can edit or delete carries one of these stamps. */
const revisionOf = (item: Item): number =>
  number(item, 'deletedAt', 'editedAt', 'timestamp', 'ts', 'lastOpenedAt', 'updatedAt')

/** Bounded so a long-running account cannot grow a key without limit. */
const LIST_CAP = 500

const byId: ArrayMergeRule = {
  merge: 'array',
  idOf: item => String(item.id ?? ''),
  revisionOf,
  cap: LIST_CAP,
}

const reactionsById: Omit<ArrayMergeRule, 'merge'> = {
  idOf: item =>
    `${String(item.messageId ?? '')}\0${String(item.actorUserId ?? item.actorId ?? '')}\0${String(item.emoji ?? '')}`,
  revisionOf,
  cap: LIST_CAP,
}

/** Take the other device's copy only when this one has nothing. */
const copy: MergeRule = { merge: 'copy' }

const sync = createDeviceSync({
  secretKey: `${APP_STORAGE_SCOPE}-account-sync-v1`,
  changedEvent: `${APP_STORAGE_SCOPE}-device-data-synced`,

  keys: {
    // Position in the rail is user-facing navigation state, so the local
    // order stands and workspaces learned from the other device are appended.
    // Sorting by last-opened would make the rail jump after every sync.
    [`${APP_STORAGE_SCOPE}-workspaces`]: {
      merge: 'array',
      idOf: item => String(item.workspaceId ?? ''),
      revisionOf,
      cap: LIST_CAP,
      preserveOrder: true,
    },
    [`${APP_STORAGE_SCOPE}-friends-v1`]: {
      merge: 'array',
      idOf: item => String(item.subjectUserId ?? ''),
      revisionOf,
      cap: LIST_CAP,
    },
    [`${APP_STORAGE_SCOPE}-friends-subs-v1`]: byId,
    [`${APP_STORAGE_SCOPE}-dm-credentials-v1`]: { merge: 'object' },
    [`${APP_STORAGE_SCOPE}-profile`]: { merge: 'object' },

    // Preferences: whatever this device already chose stays chosen.
    [`${APP_STORAGE_SCOPE}-theme`]: copy,
    [`${APP_STORAGE_SCOPE}-locale`]: copy,
    [`${APP_STORAGE_SCOPE}-dm-notifications`]: copy,
    [`${APP_STORAGE_SCOPE}-attention-sounds`]: copy,
    [`${APP_STORAGE_SCOPE}-file-sync`]: copy,
    [`${APP_STORAGE_SCOPE}-home-sidebar-width-v1`]: copy,

    // Pending invites are in flight; the sending device stays responsible.
    [`${APP_STORAGE_SCOPE}-friend-invites-in-v2`]: copy,
    [`${APP_STORAGE_SCOPE}-friend-invites-out-v2`]: copy,
  },

  prefixes: [
    // Message history, per workspace channel.
    [`${APP_STORAGE_SCOPE}-history-`, byId],
    [`${APP_STORAGE_SCOPE}-channels-`, byId],
    // Direct-message history: an envelope of messages and their reactions.
    [`${APP_STORAGE_SCOPE}-gdm-hist-v1-`, {
      merge: 'envelope',
      version: 2,
      maxFields: ['savedAt'],
      lists: { wires: byId, reactions: reactionsById },
    }],
    [`${APP_STORAGE_SCOPE}-channel-tombstones-`, copy],
    [`${APP_STORAGE_SCOPE}-dms-`, copy],
    [`${APP_STORAGE_SCOPE}-read-`, copy],
    [`${APP_STORAGE_SCOPE}-key-bindings:`, copy],
  ],
})

export const loadAccountSyncSecret = sync.loadSecret
export const ensureAccountSyncSecret = sync.ensureSecret
export const createDeviceSyncSnapshot = sync.snapshot
export const importDeviceSyncSnapshot = sync.import
