import { describe, expect, it } from 'vitest'
import { bytesToBase64Url } from './base64url.js'
import { canonicalizePublicKey } from './deviceIdentity.js'
import { signTextChat, verifyTextChat, type DeviceSigner } from './textChatSigning.js'

async function signer(): Promise<DeviceSigner> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify']
  ) as CryptoKeyPair
  const deviceKeyId = await canonicalizePublicKey(pair.publicKey)
  return {
    publicKeyId: async () => deviceKeyId,
    sign: async data => bytesToBase64Url(new Uint8Array(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data
    ))),
  }
}

describe('text chat attachment signing', () => {
  it('covers attachment metadata and rejects tampering', async () => {
    const wire = await signTextChat(await signer(), 'test-chat-v1', {
      id: 'm1',
      ts: 1,
      text: '',
      name: 'Ada',
      authorUserId: 'user-1',
      attachment: {
        id: 'a'.repeat(64),
        name: 'photo.png',
        mimeType: 'image/png',
        size: 42,
      },
    })

    expect(await verifyTextChat('test-chat-v1', wire)).toBe(true)
    expect(await verifyTextChat('test-chat-v1', {
      ...wire,
      attachment: { ...wire.attachment!, name: 'invoice.pdf' },
    })).toBe(false)
  })

  it('continues to verify messages without attachments', async () => {
    const wire = await signTextChat(await signer(), 'test-chat-v1', {
      id: 'm2', ts: 2, text: 'hello', name: 'Ada', authorUserId: 'user-1',
    })
    expect(await verifyTextChat('test-chat-v1', wire)).toBe(true)
  })
})
