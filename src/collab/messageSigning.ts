import { encodeCanonicalLines, verifyWithDeviceKeyId, type DeviceKeyId } from '@peerly/core'
import type { HistoryEntry } from '../protocol/types'
import { sanitizeReactions } from './reactionSigning'
import { verifyDeviceGrant, type DeviceGrant } from './deviceAuthorization'

/**
 * Author signatures for messages, so relayed history cannot be forged.
 *
 * Live messages are already safe: the transport stamps the sender and the
 * handshake verified who that is. History is the gap — entries arrive from
 * whichever member answered the sync request, and nothing stopped that member
 * from inventing entries attributed to anyone. Each message is therefore
 * signed at send time with the author's device key. A device key id embeds
 * the full P-256 public key (see deviceIdentity), so verification needs no key
 * distribution.
 *
 * Canonical encoding uses @peerly/core encodeCanonicalLines.
 * Wire field layout stays Peerly-specific (channels, files, v1/v2 schemes).
 */

export type SignedFields = {
  id: string
  type: 'text' | 'file'
  text: string
  fileMeta?: { id: string; name: string; mimeType: string; size: number }
  senderUserId?: string
  senderDeviceKeyId: DeviceKeyId
  timestamp: number
  channelId: string
  editedAt?: number
  deletedAt?: number
  deviceGrant?: DeviceGrant
}

export function signedMessageBytes(fields: SignedFields): Uint8Array {
  const content =
    fields.type === 'file' && fields.fileMeta
      ? [
          'file',
          fields.fileMeta.id,
          fields.fileMeta.name,
          fields.fileMeta.mimeType,
          String(fields.fileMeta.size),
        ]
      : ['text', fields.text]
  // \n cannot appear in ids/keys/timestamps; text goes last so embedded
  // newlines cannot shift any other field's position.
  const revision =
    fields.editedAt || fields.deletedAt
      ? [String(fields.editedAt ?? ''), String(fields.deletedAt ?? '')]
      : []
  return encodeCanonicalLines([
    fields.deviceGrant ? 'peerly-msg-v3' : revision.length > 0 ? 'peerly-msg-v2' : 'peerly-msg-v1',
    fields.id,
    fields.channelId,
    String(fields.timestamp),
    fields.senderUserId ?? '',
    fields.senderDeviceKeyId,
    ...(fields.deviceGrant ? [
      fields.deviceGrant.userId,
      fields.deviceGrant.issuerDeviceKeyId,
      fields.deviceGrant.subjectDeviceKeyId,
      String(fields.deviceGrant.createdAt),
      fields.deviceGrant.pairingId,
      fields.deviceGrant.sig,
    ] : []),
    ...revision,
    ...content,
  ])
}

export type EntryVerdict = 'valid' | 'invalid' | 'unsigned'

export async function verifyHistoryEntry(entry: HistoryEntry): Promise<EntryVerdict> {
  if (!entry.senderDeviceKeyId || !entry.signature) return 'unsigned'
  if (entry.deviceGrant && (
    !entry.senderUserId ||
    entry.deviceGrant.userId !== entry.senderUserId ||
    entry.deviceGrant.subjectDeviceKeyId !== entry.senderDeviceKeyId ||
    !(await verifyDeviceGrant(entry.deviceGrant))
  )) return 'invalid'
  const ok = await verifyWithDeviceKeyId(
    entry.senderDeviceKeyId,
    signedMessageBytes({
      id: entry.id,
      type: entry.type,
      text: entry.text,
      fileMeta: entry.fileMeta,
      senderUserId: entry.senderUserId,
      senderDeviceKeyId: entry.senderDeviceKeyId,
      timestamp: entry.timestamp,
      channelId: entry.channelId,
      editedAt: entry.editedAt,
      deletedAt: entry.deletedAt,
      deviceGrant: entry.deviceGrant,
    }),
    entry.signature
  )
  return ok ? 'valid' : 'invalid'
}

/**
 * Gate relayed history before it touches state or storage:
 * - invalid signature → dropped (someone altered or fabricated the entry)
 * - valid + key bound to the claimed user → kept as-is
 * - unsigned, or signed by a key not bound to the claimed user → kept, but the
 *   durable-identity claim is stripped so it cannot impersonate anyone
 */
export async function sanitizeHistoryEntries(
  entries: HistoryEntry[],
  getBoundUserId: (deviceKeyId: DeviceKeyId) => string | undefined
): Promise<HistoryEntry[]> {
  const results = await Promise.all(
    entries.map(async entry => {
      const verdict = await verifyHistoryEntry(entry)
      if (verdict === 'invalid') {
        console.warn('[Peerly] Dropped history entry with a bad signature:', entry.id)
        return null
      }
      let safeEntry = entry
      if (verdict === 'unsigned') {
        safeEntry = entry.senderUserId === undefined ? entry : { ...entry, senderUserId: undefined }
      } else {
        const bound = entry.senderDeviceKeyId
          ? getBoundUserId(entry.senderDeviceKeyId)
          : undefined
        const grantBound = entry.deviceGrant &&
          getBoundUserId(entry.deviceGrant.issuerDeviceKeyId) === entry.senderUserId
        if (entry.senderUserId && bound !== entry.senderUserId && !grantBound) {
          safeEntry = { ...entry, senderUserId: undefined }
        }
      }
      const reactions = await sanitizeReactions(
        safeEntry.reactions ?? [],
        safeEntry.id,
        safeEntry.channelId,
        getBoundUserId
      )
      return reactions.length > 0 || safeEntry.reactions
        ? { ...safeEntry, reactions }
        : safeEntry
    })
  )
  return results.filter((entry): entry is HistoryEntry => entry !== null)
}
