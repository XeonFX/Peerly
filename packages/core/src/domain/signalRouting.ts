/**
 * How a signalling frame reaches its recipients.
 *
 * The scope forwards opaque SDP/ICE and reads only routing fields, so these
 * rules never touch the payload beside them. Broadcasting everything made
 * signalling O(N²) in a room and handed every participant every other pair's
 * envelopes; routing by claimed topic makes it O(N) and private, while an
 * unclaimed topic still broadcasts so a room-wide announce keeps working.
 */
import { LIMITS } from '../protocol/limits.js'

export type Participant = {
  readonly cid: string
  readonly topics: readonly string[]
}

export type Routing =
  | { readonly kind: 'direct'; readonly cid: string }
  | { readonly kind: 'topic'; readonly cids: readonly string[] }
  | { readonly kind: 'broadcast' }

export function routeSignal(
  frame: { to?: string; topic?: string },
  participants: readonly Participant[],
  sender: string
): Routing {
  if (typeof frame.to === 'string' && frame.to) return { kind: 'direct', cid: frame.to }

  if (typeof frame.topic === 'string' && frame.topic) {
    const cids = participants
      .filter(participant => participant.cid !== sender && participant.topics.includes(frame.topic!))
      .map(participant => participant.cid)
    // Falling through to broadcast for an unclaimed topic is deliberate: a
    // peer that has not yet claimed its topic would otherwise miss the very
    // offer that is trying to reach it.
    if (cids.length > 0) return { kind: 'topic', cids }
  }

  return { kind: 'broadcast' }
}

/**
 * Which topics a participant may claim, bounded by what will fit in a
 * serialized socket attachment.
 *
 * The runtime hard-caps an attachment, and exceeding it *throws inside the
 * message handler*, which loses the socket. Dropping a topic costs one
 * broadcast fallback; throwing costs the connection — so this trims rather
 * than rejects.
 */
export function claimableTopics(
  requested: readonly unknown[],
  attachmentOverheadBytes: number
): string[] {
  const claimed: string[] = []
  let budget = LIMITS.attachmentBytes - attachmentOverheadBytes
  for (const topic of requested) {
    if (typeof topic !== 'string' || !topic || topic.length > 256) continue
    if (claimed.length >= LIMITS.topicsPerParticipant) break
    // Quoted string plus separator in the serialized form.
    budget -= topic.length + 3
    if (budget < 0) break
    claimed.push(topic)
  }
  return claimed
}

/** A scope is finished when nobody is connected and no authorization remains,
 *  at which point its storage can go. */
export function isScopeAbandoned(openSockets: number, liveAuthorizations: number): boolean {
  return openSockets === 0 && liveAuthorizations === 0
}
