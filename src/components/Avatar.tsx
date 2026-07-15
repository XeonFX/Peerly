import { DEFAULT_USER_COLOR } from '../config'
import { safeAvatarUrl } from '../utils/avatarUrl'
import { safeColor } from '../utils/profileSanitize'

type Props = {
  name: string
  color: string
  avatar?: string
  size?: 'sm' | 'md' | 'lg'
}

export function Avatar({ name, color, avatar, size = 'sm' }: Props) {
  const cls =
    size === 'lg' ? 'avatar avatar-lg' : size === 'md' ? 'avatar avatar-md' : 'avatar avatar-sm'

  // Single render choke point for every avatar in the app, peer-supplied or not.
  const src = safeAvatarUrl(avatar)
  if (src) {
    return <img src={src} alt={name} className={`${cls} avatar-img`} />
  }

  return (
    <span className={cls} style={{ background: safeColor(color, DEFAULT_USER_COLOR) }}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}