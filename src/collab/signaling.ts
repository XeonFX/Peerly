import { resolveSignalingStrategy, signalingLabel, type SignalingStrategy } from '@peerly/core'
import { PUBLIC_NETWORK_ENV } from '../config'

export type { SignalingStrategy }

/**
 * Strategy resolution lives in @peerly/core (resolveSignalingStrategy); these
 * wrappers bind it to this app's build-time env, which a library cannot read
 * on our behalf — Vite replaces `import.meta.env` per bundle.
 */
export function getSignalingStrategy(): SignalingStrategy {
  return resolveSignalingStrategy(PUBLIC_NETWORK_ENV)
}

export function getSignalingLabel(): string {
  return signalingLabel(getSignalingStrategy())
}
