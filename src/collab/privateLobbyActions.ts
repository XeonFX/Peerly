import { base64UrlToBytes, bytesToBase64Url, type RelayChannelAction, type RelayChannelRoom } from '@peerly/core'

const SCHEME = 'peerly-private-lobby-v1'
const KEY_PATTERN = /^[A-Za-z0-9_-]{87}$/
const MAX_PEERS = 1_000
const MAX_DEVICES = 8
const MAX_CIPHERTEXT = 64 * 1024

type Envelope = {
  v: 1
  senderKey: string
  recipientKey: string
  iv: string
  ciphertext: string
}

/**
 * Invitations contain the roots of workspace/DM encryption. Signing alone
 * does not hide those roots from the lobby relay. Keys admitted here MUST
 * come from a verified, OIDC-bound signed presence message, never raw frames.
 */
export function createPrivateLobbyActions(room: Pick<RelayChannelRoom, 'makeAction'>) {
  const keys = crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey'])
  const publicKey = keys.then(async pair =>
    bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))))
  const peers = new Map<string, Map<string, string>>()

  const keyFor = async (peerKey: string) => crypto.subtle.deriveKey({
    name: 'ECDH',
    public: await crypto.subtle.importKey('raw', new Uint8Array(base64UrlToBytes(peerKey)),
      { name: 'ECDH', namedCurve: 'P-256' }, false, []),
  }, (await keys).privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const aad = (event: string, senderKey: string, recipientKey: string) =>
    new TextEncoder().encode(JSON.stringify([SCHEME, event, senderKey, recipientKey]))

  return {
    publicKey: () => publicKey,
    async rememberVerifiedPeer(peerId: string, deviceKeyId: string, value: unknown): Promise<boolean> {
      if (typeof value !== 'string' || !KEY_PATTERN.test(value)) return false
      try {
        // Reject malformed curve points before a peer enters the delivery index.
        await keyFor(value)
      } catch { return false }
      const devices = peers.get(peerId) ?? new Map<string, string>()
      devices.delete(deviceKeyId)
      devices.set(deviceKeyId, value)
      if (devices.size > MAX_DEVICES) devices.delete(devices.keys().next().value!)
      peers.delete(peerId)
      peers.set(peerId, devices)
      if (peers.size > MAX_PEERS) peers.delete(peers.keys().next().value!)
      return true
    },
    forgetPeer(peerId: string) { peers.delete(peerId) },
    makeAction<T>(event: string): RelayChannelAction<T> {
      const raw = room.makeAction<Envelope>(event)
      const action: RelayChannelAction<T> = {
        onMessage: null,
        async send(value, options) {
          const target = options?.target
          const recipients = target ? peers.get(target) : undefined
          // Offline/old clients stay in the existing invitation retry queue.
          // There is deliberately no plaintext fallback or broadcast.
          if (!target || !recipients) return
          const senderKey = await publicKey
          for (const recipientKey of new Set(recipients.values())) {
            const iv = crypto.getRandomValues(new Uint8Array(12))
            const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
              additionalData: aad(event, senderKey, recipientKey) }, await keyFor(recipientKey),
            new TextEncoder().encode(JSON.stringify(value)))
            await raw.send({ v: 1, senderKey, recipientKey,
              iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(encrypted)) }, { target })
          }
        },
      }
      raw.onMessage = (wire, meta) => {
        void (async () => {
          if (!wire || wire.v !== 1 || wire.recipientKey !== await publicKey ||
            ![...(peers.get(meta.peerId)?.values() ?? [])].includes(wire.senderKey) ||
            typeof wire.iv !== 'string' || wire.iv.length !== 16 ||
            typeof wire.ciphertext !== 'string' || wire.ciphertext.length > MAX_CIPHERTEXT) return
          const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM',
            iv: new Uint8Array(base64UrlToBytes(wire.iv)),
            additionalData: aad(event, wire.senderKey, wire.recipientKey) },
          await keyFor(wire.senderKey), new Uint8Array(base64UrlToBytes(wire.ciphertext)))
          action.onMessage?.(JSON.parse(new TextDecoder().decode(plaintext)) as T, meta)
        })().catch(() => { /* Reject tampered, replayed-to-another-recipient or plaintext frames. */ })
      }
      return action
    },
  }
}
