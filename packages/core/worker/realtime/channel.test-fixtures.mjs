import { env } from 'cloudflare:workers'

export const channelIdentity = name => ({
  uid: `opaque-${name.padEnd(24, 'x')}`,
  publicUserId: `user-${name}`,
  userId: `user-${name}`,
  deviceKeyId: `P-256:${name.padEnd(43, 'a')}:${name.padEnd(43, 'b')}`,
  principalId: `principal-${name}`,
})

export async function channelSession(user, ttlMs = 60_000) {
  return env.USER_GATEWAYS.getByName(`peerly:${user.uid}`).registerSession({
    uid: user.uid, dk: user.deviceKeyId, ttlMs, now: Date.now(),
  })
}
