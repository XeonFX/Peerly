import { avatarInitial } from '@peerly/core'
import { DEFAULT_USER_COLOR } from '../config'
import { safeAvatarUrl } from '../utils/avatarUrl'
import { safeColor } from '../utils/profileSanitize'

type Props = {
  name: string
  color: string
  avatar?: string
  size?: 'sm' | 'md' | 'lg'
  shape?: 'rounded' | 'circle'
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
  sm: 'w-6 h-6 text-[0.7rem]',
  md: 'w-10 h-10 text-base',
  lg: 'avatar-lg w-18 h-18 text-2xl',
} as const

const SHAPES = {
  rounded: { sm: 'rounded-md', md: 'rounded-lg', lg: 'rounded-xl' },
  circle: { sm: 'rounded-full', md: 'rounded-full', lg: 'rounded-full' },
} as const

export function Avatar({ name, color, avatar, size = 'sm', shape = 'rounded' }: Props) {
  const base = `inline-flex shrink-0 items-center justify-center overflow-hidden font-bold text-white ${SIZES[size]} ${SHAPES[shape][size]}`

  // Single render choke point for every avatar in the app, peer-supplied or not.
  const src = safeAvatarUrl(avatar)
  if (src) {
    return <img src={src} alt={name} className={`${base} avatar-img object-cover`} />
  }

  return (
    <span className={base} style={{ background: safeColor(color, DEFAULT_USER_COLOR) }}>
      {avatarInitial(name)}
    </span>
  )
}
