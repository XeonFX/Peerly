import { encodeCanonicalLines, verifyWithDeviceKeyId, type DeviceKeyId } from '@peerly/core'
import type { ReactionRecord } from '../types'

export type SignedReactionFields = {
  messageId: string
  channelId: string
  emoji: string
  active: boolean
  actorUserId?: string
  actorDeviceKeyId: DeviceKeyId
  timestamp: number
}

export function signedReactionBytes(fields: SignedReactionFields): Uint8Array {
  return encodeCanonicalLines([
    'peerly-reaction-v1',
    fields.messageId,
    fields.channelId,
    fields.emoji,
    fields.active ? '1' : '0',
    fields.actorUserId ?? '',
    fields.actorDeviceKeyId,
    String(fields.timestamp),
  ])
}

export async function verifyReaction(
  reaction: ReactionRecord,
  messageId: string,
  channelId: string
): Promise<boolean> {
  if (!reaction.actorDeviceKeyId || !reaction.signature) return false
  return verifyWithDeviceKeyId(
    reaction.actorDeviceKeyId,
    signedReactionBytes({
      messageId,
      channelId,
      emoji: reaction.emoji,
      active: reaction.active,
      actorUserId: reaction.actorUserId,
      actorDeviceKeyId: reaction.actorDeviceKeyId,
      timestamp: reaction.timestamp,
    }),
    reaction.signature
  )
}

export async function sanitizeReactions(
  reactions: ReactionRecord[],
  messageId: string,
  channelId: string,
  getBoundUserId: (deviceKeyId: DeviceKeyId) => string | undefined
): Promise<ReactionRecord[]> {
  const safe = await Promise.all(
    reactions.slice(-200).map(async reaction => {
      if (!['👍', '❤️', '😂', '🎉'].includes(reaction.emoji)) return null
      if (!(await verifyReaction(reaction, messageId, channelId))) return null
      const bound = reaction.actorDeviceKeyId
        ? getBoundUserId(reaction.actorDeviceKeyId)
        : undefined
      return reaction.actorUserId && bound !== reaction.actorUserId
        ? { ...reaction, actorUserId: undefined }
        : reaction
    })
  )
  return safe.filter((reaction): reaction is ReactionRecord => reaction !== null)
}
