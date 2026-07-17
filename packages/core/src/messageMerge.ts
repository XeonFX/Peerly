/**
 * Pure merge rules for revisable chat messages and per-actor reactions.
 * Apps map their own types onto these helpers — no transport coupling.
 */

export type RevisionFields = {
  editedAt?: number
  deletedAt?: number
}

/** Max of edit/delete timestamps — higher means a newer revision. */
export function revisionScore(fields: RevisionFields): number {
  return Math.max(fields.editedAt ?? 0, fields.deletedAt ?? 0)
}

/**
 * Whether `incoming` should replace `existing` content.
 * Same author is required when both sides declare an author key.
 * `strict` (default true) requires a strictly greater revision score (Peerly);
 * HeyHubs uses `strict: false` so equal scores prefer the latest packet.
 */
export function isAcceptableRevision(
  existing: RevisionFields,
  incoming: RevisionFields,
  options: {
    existingAuthorKey?: string
    incomingAuthorKey?: string
    strict?: boolean
  } = {}
): boolean {
  const { existingAuthorKey, incomingAuthorKey, strict = true } = options
  if (existingAuthorKey && incomingAuthorKey && existingAuthorKey !== incomingAuthorKey) {
    return false
  }
  const existingRev = revisionScore(existing)
  const incomingRev = revisionScore(incoming)
  return strict ? incomingRev > existingRev : incomingRev >= existingRev
}

/**
 * Keep the latest reaction per (actor, emoji). Later `timestamp` wins;
 * inactive reactions replace active ones when newer.
 */
export function mergeReactionsByActorKey<T extends { emoji: string; timestamp: number }>(
  current: readonly T[] = [],
  incoming: readonly T[] = [],
  actorKey: (reaction: T) => string
): T[] {
  const latest = new Map<string, T>()
  for (const reaction of [...current, ...incoming]) {
    const key = `${actorKey(reaction)}\n${reaction.emoji}`
    if ((latest.get(key)?.timestamp ?? -1) < reaction.timestamp) latest.set(key, reaction)
  }
  return [...latest.values()]
}

/**
 * Toggle-style reaction list used by simple chats: one entry per (author, emoji),
 * inactive removes the row rather than keeping a tombstone.
 */
export function applyToggleReaction<
  T extends { emoji: string; authorKey: string; active: boolean },
>(list: readonly T[] | undefined, reaction: T): T[] {
  const prev = list ?? []
  const filtered = prev.filter(
    item => !(item.authorKey === reaction.authorKey && item.emoji === reaction.emoji)
  )
  if (!reaction.active) return filtered
  return [...filtered, reaction]
}

/** Insert or replace by id, sorted by `timestamp` ascending. */
export function upsertByIdSorted<T extends { id: string; timestamp: number }>(
  prev: readonly T[],
  next: T,
  merge: (existing: T, incoming: T) => T
): T[] {
  const index = prev.findIndex(item => item.id === next.id)
  if (index < 0) return [...prev, next].sort((a, b) => a.timestamp - b.timestamp)
  const merged = merge(prev[index], next)
  if (merged === prev[index]) return prev as T[]
  const copy = [...prev]
  copy[index] = merged
  return copy
}
