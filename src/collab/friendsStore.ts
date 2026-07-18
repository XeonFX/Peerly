import {
  addPeopleEntry,
  createPeopleAttestation,
  emptyPeopleList,
  isSubjectListed,
  loadPeopleList,
  ownEntriesNewestFirst,
  removePeopleEntry,
  savePeopleList,
  type PeopleAttestation,
  type PeopleList,
} from '@peerly/core'
import type { DeviceIdentity } from './deviceIdentity'

/**
 * Personal friends list for Peerly. Built on `@peerly/core` peopleList with
 * scheme `peerly-friend-v1`. Entries capture a verified email from the
 * workspace identity handshake so the workspace creator can invite them
 * without retyping.
 */

const SCHEME = 'peerly-friend-v1'
const STORAGE_KEY = 'peerly-friends-v1'
const SUBS_KEY = 'peerly-friends-subs-v1'

export type Friend = PeopleAttestation

export function loadFriends(): PeopleList {
  return loadPeopleList(STORAGE_KEY, SUBS_KEY)
}

export function saveFriends(list: PeopleList): void {
  savePeopleList(list, STORAGE_KEY, SUBS_KEY)
}

export function emptyFriends(): PeopleList {
  return emptyPeopleList()
}

export function listFriends(list: PeopleList): Friend[] {
  return ownEntriesNewestFirst(list)
}

export function isFriend(list: PeopleList, userId: string | undefined): boolean {
  return isSubjectListed(list, userId)
}

export async function addFriend(
  list: PeopleList,
  identity: DeviceIdentity,
  input: {
    ownerUserId: string
    subjectUserId: string
    subjectName: string
    subjectEmail: string
  }
): Promise<Friend> {
  const entry = await createPeopleAttestation(identity, SCHEME, {
    kind: 'friend',
    ownerUserId: input.ownerUserId,
    subjectUserId: input.subjectUserId,
    subjectName: input.subjectName,
    subjectEmail: input.subjectEmail,
  })
  addPeopleEntry(list, entry)
  saveFriends(list)
  return entry
}

export function removeFriend(list: PeopleList, subjectUserId: string): boolean {
  const changed = removePeopleEntry(list, subjectUserId)
  if (changed) saveFriends(list)
  return changed
}

/** Friends that carry an email and are not already on the allow-list. */
export function inviteableFriendEmails(
  list: PeopleList,
  alreadyInvited: readonly string[]
): Friend[] {
  const invited = new Set(alreadyInvited.map(email => email.trim().toLowerCase()))
  return listFriends(list).filter(friend => {
    const email = friend.subjectEmail?.trim().toLowerCase()
    return !!email && email.includes('@') && !invited.has(email)
  })
}
