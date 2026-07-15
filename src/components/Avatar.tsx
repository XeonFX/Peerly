import { DEFAULT_USER_COLOR } from '../config'
import { safeAvatarUrl } from '../utils/avatarUrl'
import { safeColor } from '../utils/profileSanitize'

type Props = {
  name: string
  color: string
  avatar?: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Sizes as utilities rather than a shared `.avatar` class.
 *
 * DaisyUI ships its own `.avatar` component (position: relative, plus rules for
 * descendant imgs), so reusing that name would silently apply its layout to
 * ours. `avatar-img` and `avatar-lg` are kept purely as hooks the E2E suite
 * asserts against — they carry no styling.
 */
const SIZES = {
  sm: 'w-6 h-6 text-[0.7rem] rounded-md',
  md: 'w-10 h-10 text-base rounded-lg',
  lg: 'avatar-lg w-18 h-18 text-2xl rounded-xl',
} as const

export function Avatar({ name, color, avatar, size = 'sm' }: Props) {
  const base = `inline-flex shrink-0 items-center justify-center overflow-hidden font-bold text-white ${SIZES[size]}`

  // Single render choke point for every avatar in the app, peer-supplied or not.
  const src = safeAvatarUrl(avatar)
  if (src) {
    return <img src={src} alt={name} className={`${base} avatar-img object-cover`} />
  }

  return (
    <span className={base} style={{ background: safeColor(color, DEFAULT_USER_COLOR) }}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
