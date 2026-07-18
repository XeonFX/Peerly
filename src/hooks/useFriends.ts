import { useCallback, useMemo, useRef, useState } from 'react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import {
  addFriend,
  inviteableFriendEmails,
  isFriend,
  listFriends,
  loadFriends,
  removeFriend,
  type Friend,
} from '../collab/friendsStore'

/**
 * Personal friends list (device-local, signed). Emails come from verified
 * workspace handshakes — never from untrusted chat payloads.
 */
export function useFriends(identity: DeviceIdentity | null, ownerUserId: string | undefined) {
  const listRef = useRef(loadFriends())
  const [version, setVersion] = useState(0)

  const friends = useMemo(() => {
    void version
    return listFriends(listRef.current)
  }, [version])

  const add = useCallback(
    async (subject: { userId: string; name: string; email: string }) => {
      if (!identity || !ownerUserId) return
      if (!subject.userId || subject.userId === ownerUserId) return
      if (!subject.email.includes('@')) return
      await addFriend(listRef.current, identity, {
        ownerUserId,
        subjectUserId: subject.userId,
        subjectName: subject.name || subject.email,
        subjectEmail: subject.email,
      })
      setVersion(v => v + 1)
    },
    [identity, ownerUserId]
  )

  const remove = useCallback((subjectUserId: string) => {
    if (removeFriend(listRef.current, subjectUserId)) setVersion(v => v + 1)
  }, [])

  const has = useCallback(
    (userId: string | undefined) => {
      void version
      return isFriend(listRef.current, userId)
    },
    [version]
  )

  const inviteable = useCallback(
    (alreadyInvited: readonly string[]) => {
      void version
      return inviteableFriendEmails(listRef.current, alreadyInvited)
    },
    [version]
  )

  return { friends, add, remove, has, inviteable }
}

export type { Friend }
