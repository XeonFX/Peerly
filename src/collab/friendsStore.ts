/**
 * This app's friends list.
 *
 * The store itself lives in `@peerly/core`; what stays here is what is
 * genuinely this product's: the attestation scheme and storage keys (which
 * must differ from the other app's, or entries would cross-verify), and the
 * verified email an entry carries so a workspace invite needs no retyping.
 */
import { createFriendsStore, type Friend, type PeopleList } from '@peerly/core'
import type { DeviceIdentity } from './deviceIdentity'
import { APP_STORAGE_SCOPE } from '../config'

export type { Friend }

const store = createFriendsStore({
  scheme: `${APP_STORAGE_SCOPE}-friend-v1`,
  storageKey: `${APP_STORAGE_SCOPE}-friends-v1`,
  subscriptionsKey: `${APP_STORAGE_SCOPE}-friends-subs-v1`,
  credentialsKey: `${APP_STORAGE_SCOPE}-dm-credentials-v1`,
})

export const loadFriends = store.load
export const saveFriends = store.save
export const emptyFriends = store.empty
export const listFriends = store.list
export const isFriend = store.has
export const removeFriend = store.remove
export const dmSecretForFriend = store.dmSecretFor
export const dmDeviceKeyForFriend = store.deviceKeyFor

export async function addFriend(
  list: PeopleList,
  identity: DeviceIdentity,
  input: {
    ownerUserId: string
    subjectUserId: string
    subjectName: string
    subjectEmail: string
    dmSecret?: string
    subjectDeviceKeyId?: string
  }
): Promise<Friend | null> {
  return store.add(list, identity, {
    ownerUserId: input.ownerUserId,
    subjectUserId: input.subjectUserId,
    subjectName: input.subjectName,
    // Signed alongside the rest of the entry, so the address cannot be edited
    // after the fact without invalidating the attestation.
    extraFields: { subjectEmail: input.subjectEmail },
    ...(input.dmSecret ? { dmSecret: input.dmSecret } : {}),
    ...(input.subjectDeviceKeyId ? { subjectDeviceKeyId: input.subjectDeviceKeyId } : {}),
  })
}

export function friendDmSecret(friend: Friend | undefined): string | undefined {
  return friend ? dmSecretForFriend(loadFriends(), friend.subjectUserId) : undefined
}

export function friendDmDeviceKey(friend: Friend | null | undefined): string | undefined {
  return friend ? dmDeviceKeyForFriend(loadFriends(), friend.subjectUserId) : undefined
}

/** Friends that carry an email and are not already on the allow-list. */
export function inviteableFriendEmails(
  list: PeopleList,
  alreadyInvited: readonly string[]
): Friend[] {
  const invited = new Set(alreadyInvited.map(email => email.trim().toLowerCase()))
  return listFriends(list).filter(friend => {
    const email = friend.subjectEmail?.trim().toLowerCase()
    return Boolean(email) && email!.includes('@') && !invited.has(email!)
  })
}
