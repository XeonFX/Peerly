import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity'
import type { HistoryEntry } from '../protocol/types'

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
 * What a valid signature proves: the holder of that device key authored these
 * exact fields. Binding the key to a *person* (durable userId) comes from live
 * handshakes (see keyBindings): entries signed by a key we've never met keep
 * their text but have their identity claim stripped rather than trusted.
 *
 * Unsigned entries are tolerated (older app versions) but likewise carry no
 * identity claim — otherwise stripping the signature would be the forgery.
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
}

export function signedMessageBytes(fields: SignedFields): Uint8Array {
  const content =
    fields.type === 'file' && fields.fileMeta
      ? ['file', fields.fileMeta.id, fields.fileMeta.name, fields.fileMeta.mimeType, String(fields.fileMeta.size)]
      : ['text', fields.text]
  // \n cannot appear in ids/keys/timestamps; text goes last so embedded
  // newlines cannot shift any other field's position.
  return new TextEncoder().encode(
    [
      'peerly-msg-v1',
      fields.id,
      fields.channelId,
      String(fields.timestamp),
      fields.senderUserId ?? '',
      fields.senderDeviceKeyId,
      ...content,
    ].join('\n')
  )
}

export type EntryVerdict = 'valid' | 'invalid' | 'unsigned'

export async function verifyHistoryEntry(entry: HistoryEntry): Promise<EntryVerdict> {
  if (!entry.senderDeviceKeyId || !entry.signature) return 'unsigned'
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
      if (verdict === 'unsigned') {
        return entry.senderUserId === undefined ? entry : { ...entry, senderUserId: undefined }
      }
      const bound = entry.senderDeviceKeyId ? getBoundUserId(entry.senderDeviceKeyId) : undefined
      if (entry.senderUserId && bound !== entry.senderUserId) {
        return { ...entry, senderUserId: undefined }
      }
      return entry
    })
  )
  return results.filter((entry): entry is HistoryEntry => entry !== null)
}
