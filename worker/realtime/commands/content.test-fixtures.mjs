import { deriveChannelCapability } from '../../../packages/core/dist/channelCapability.js'

export async function workspacePolicy({
  secret = crypto.randomUUID(),
  emails = ['alice@e2e.test', 'bob@e2e.test'],
  signedAt = Date.now(),
  keys,
} = {}) {
  keys ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const creatorKeyId = `P-256:${jwk.x}:${jwk.y}`
  const capability = await deriveChannelCapability(secret, `workspace-content:${creatorKeyId}`)
  const canonical = [...new Set(emails.map(email => email.trim().toLowerCase()))].sort()
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey,
    new TextEncoder().encode(JSON.stringify(['peerly-workspace-members-v2', capability, canonical, signedAt])))
  return {
    secret, keys,
    payload: {
      capability, creatorKeyId,
      allowList: {
        emails: canonical, signedAt, scope: capability,
        signature: btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''),
      },
    },
  }
}
