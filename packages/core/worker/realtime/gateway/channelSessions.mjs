/** Channel sockets keep their revocation/expiry state in hibernation
 * attachments. A gateway records subscribers before the upgrade completes,
 * then synchronously revokes them before acknowledging device.revoke. */
export function activeChannelSession(socket, now = Date.now()) {
  const attachment = socket.deserializeAttachment()
  return Boolean(attachment && !attachment.revoked && attachment.sessionExpiresAt > now)
}

export async function bindChannelSession(object, socket, binding) {
  const attachment = socket.deserializeAttachment()
  const namespace = object.env.USER_GATEWAYS
  const app = object.env.APP_ID?.trim()
  if (!namespace || !app || !attachment?.uid || !attachment.sid) return false
  try {
    const result = await namespace.getByName(`${app}:${attachment.uid}`).subscribeChannelSession({
      uid: attachment.uid, dk: attachment.deviceKeyId, sid: attachment.sid,
      binding, objectId: object.ctx.id.toString(),
    })
    // A revoke may have arrived while registration was awaiting the gateway.
    const current = socket.deserializeAttachment()
    if (!result.ok || current?.revoked) return false
    socket.serializeAttachment({ ...current, sessionExpiresAt: result.expiresAt })
    const alarm = await object.ctx.storage.getAlarm()
    if (alarm === null || alarm > result.expiresAt) await object.ctx.storage.setAlarm(result.expiresAt)
    return activeChannelSession(socket)
  } catch { return false }
}

export function revokeChannelSession(object, { uid, dk, sid }) {
  for (const socket of object.ctx.getWebSockets()) {
    const value = socket.deserializeAttachment()
    if (value?.uid === uid && value.deviceKeyId === dk && value.sid === sid) {
      socket.serializeAttachment({ ...value, revoked: true })
      socket.close(4001, 'device revoked')
    }
  }
  return { ok: true }
}

export function expireChannelSessions(object) {
  let next = Infinity
  for (const socket of object.ctx.getWebSockets()) {
    if (!activeChannelSession(socket)) socket.close(4001, 'session expired')
    else next = Math.min(next, socket.deserializeAttachment().sessionExpiresAt)
  }
  return next
}
