import { useEffect, useState } from 'react'
import { WORKSPACE_COLOR } from '../config'
import { resolveAvatarPreview } from '../collab/avatarService'
import { Avatar } from './Avatar'

type Props = {
  name: string
  /** IndexedDB-backed avatar id; resolved to a preview URL on mount. */
  avatarId?: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Workspace icon that resolves its stored avatar id to a preview URL. Shared by
 * the join-screen picker and the workspace rail so both render the same icon.
 */
export function WorkspaceAvatar({ name, avatarId, size = 'md' }: Props) {
  const [preview, setPreview] = useState<string>()
  useEffect(() => {
    let cancelled = false
    void resolveAvatarPreview(avatarId).then(url => {
      if (!cancelled && url) setPreview(url)
    })
    return () => {
      cancelled = true
    }
  }, [avatarId])

  return <Avatar name={name} color={WORKSPACE_COLOR} avatar={preview} size={size} />
}
