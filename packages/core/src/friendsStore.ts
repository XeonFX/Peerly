import {
  addPeopleEntry, createPeopleAttestation, emptyPeopleList, isSubjectListed,
  loadPeopleList, ownEntriesNewestFirst, removePeopleEntry, savePeopleList,
  type PeopleAttestation, type PeopleList,
} from './peopleList.js'
import { createDmCredentialStore } from './dmCredentials.js'
import type { DeviceSigner } from './textChatSigning.js'

/**
 * A personal, signed friends list plus the DM credentials that go with it.
 *
 * Both apps had their own copy. They agreed on the mechanism and differed in
 * two ways that matter and one that did not:
 *
 *  - what an entry records: one app captures a verified email from its
 *    identity handshake so a workspace invite needs no retyping, the other is
 *    deliberately userId-only because its users are strangers. That is a real
 *    product difference, so `extraFields` stays open.
 *  - scheme and storage keys, which *must* differ or the two products would
 *    read each other's lists.
 *  - one of them reimplemented DM credential storage inline that already
 *    existed in this package. That was duplication, not a difference.
 */
export type FriendsStoreConfig = {
  /** Attestation scheme. Distinct per app: an entry signed for one product
   *  must not verify as an entry of the other. */
  readonly scheme: string
  readonly storageKey: string
  readonly subscriptionsKey: string
  readonly credentialsKey: string
}

export type Friend = PeopleAttestation

export type AddFriendInput = {
  readonly ownerUserId: string
  readonly subjectUserId: string
  readonly subjectName: string
  /** Additional signed fields this app records about a friend. */
  readonly extraFields?: Record<string, string>
  readonly dmSecret?: string
  readonly subjectDeviceKeyId?: string
}

export type FriendsStore = {
  load(): PeopleList
  save(list: PeopleList): void
  empty(): PeopleList
  list(list: PeopleList): Friend[]
  has(list: PeopleList, userId: string | undefined): boolean
  /** Returns `null` when the input names nobody, or names the owner. */
  add(list: PeopleList, signer: DeviceSigner, input: AddFriendInput): Promise<Friend | null>
  remove(list: PeopleList, subjectUserId: string): boolean
  dmSecretFor(list: PeopleList, userId: string): string | undefined
  deviceKeyFor(list: PeopleList, userId: string): string | undefined
}

export function createFriendsStore(config: FriendsStoreConfig): FriendsStore {
  const credentials = createDmCredentialStore(config.credentialsKey)

  const find = (list: PeopleList, userId: string): Friend | undefined =>
    ownEntriesNewestFirst(list).find(entry => entry.subjectUserId === userId)

  return {
    load: () => loadPeopleList(config.storageKey, config.subscriptionsKey),
    save: list => savePeopleList(list, config.storageKey, config.subscriptionsKey),
    empty: () => emptyPeopleList(),
    list: list => ownEntriesNewestFirst(list),
    has: (list, userId) => Boolean(userId) && isSubjectListed(list, userId!),

    async add(list, signer, input) {
      // Befriending yourself is always a mistake, and an entry with no subject
      // is unusable. One app checked this and the other did not; checking is
      // the correct behaviour, so both get it.
      if (!input.subjectUserId || input.subjectUserId === input.ownerUserId) return null

      const entry = await createPeopleAttestation(signer, config.scheme, {
        kind: 'friend',
        ownerUserId: input.ownerUserId,
        subjectUserId: input.subjectUserId,
        // Falling back to the id keeps an entry renderable when a peer sent no
        // display name, rather than showing an empty row.
        subjectName: input.subjectName || input.subjectUserId,
        ...(input.extraFields ?? {}),
      })

      if (input.dmSecret && input.subjectDeviceKeyId) {
        credentials.set(input.subjectUserId, {
          secret: input.dmSecret.toLowerCase(),
          deviceKeyId: input.subjectDeviceKeyId,
        })
      }

      addPeopleEntry(list, entry)
      savePeopleList(list, config.storageKey, config.subscriptionsKey)
      return entry
    },

    remove(list, subjectUserId) {
      const removed = removePeopleEntry(list, subjectUserId)
      if (removed) {
        credentials.remove(subjectUserId)
        savePeopleList(list, config.storageKey, config.subscriptionsKey)
      }
      return removed
    },

    dmSecretFor(list, userId) {
      // Only for someone actually on the list: a stale credential must not
      // outlive the friendship that justified it.
      return find(list, userId) ? credentials.get(userId)?.secret : undefined
    },

    deviceKeyFor(list, userId) {
      return find(list, userId) ? credentials.get(userId)?.deviceKeyId : undefined
    },
  }
}
