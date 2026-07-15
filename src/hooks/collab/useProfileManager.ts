import { useCallback, useEffect, useRef } from 'react'
import { removeAvatar, uploadAvatar } from '../../collab/avatarService'
import type { UserProfile } from '../../types'

export function useProfileManager(
  profile: UserProfile,
  avatarId: string | undefined,
  onProfileChange?: (profile: UserProfile & { avatarId?: string }) => void
) {
  const profileRef = useRef(profile)
  profileRef.current = profile
  const avatarIdRef = useRef(avatarId)

  useEffect(() => {
    avatarIdRef.current = avatarId
  }, [avatarId])

  const updateProfile = useCallback(
    (next: Partial<UserProfile> & { avatarId?: string }) => {
      if (next.avatarId !== undefined) {
        avatarIdRef.current = next.avatarId
      }
      const merged: UserProfile & { avatarId?: string } = {
        ...profileRef.current,
        ...next,
        name: next.name ?? profileRef.current.name,
        avatarId: next.avatarId ?? avatarIdRef.current,
      }
      onProfileChange?.(merged)
    },
    [onProfileChange]
  )

  const setAvatar = useCallback(
    async (file: File) => {
      const { avatarId: nextId, dataUrl } = await uploadAvatar(file, avatarIdRef.current)
      avatarIdRef.current = nextId
      updateProfile({ avatar: dataUrl, avatarId: nextId })
    },
    [updateProfile]
  )

  const clearAvatar = useCallback(async () => {
    await removeAvatar(avatarIdRef.current)
    avatarIdRef.current = undefined
    updateProfile({ avatar: undefined, avatarId: undefined })
  }, [updateProfile])

  return { updateProfile, setAvatar, clearAvatar }
}