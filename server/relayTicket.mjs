import { createHmac, timingSafeEqual } from 'node:crypto'

export function parseRelayTicketSecrets(raw, required = true) {
  const map = new Map()
  for (const entry of (raw || '').split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) throw new Error(`RELAY_TICKET_SECRETS entry is not host=value: "${trimmed}"`)
    const host = trimmed.slice(0, eq).trim().toLowerCase()
    const secret = trimmed.slice(eq + 1).trim()
    if (!host || !secret) throw new Error('RELAY_TICKET_SECRETS entry has an empty host or value')
    map.set(host, secret)
  }
  if (required && map.size === 0) throw new Error('RELAY_TICKET_SECRETS is empty')
  return map
}

export function verifyRelayTicket(ticket, host, secretsByHost, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    const normalizedHost = host.toLowerCase()
    const secret = secretsByHost.get(normalizedHost)
    const [body, signature, extra] = ticket.split('.')
    if (!secret || !body || !signature || extra) return null
    const expected = createHmac('sha256', secret).update(body).digest()
    const received = Buffer.from(signature, 'base64url')
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    const valid = payload.v === 1 && payload.aud === normalizedHost &&
      typeof payload.sub === 'string' && payload.sub.length > 0 && payload.sub.length <= 512 &&
      typeof payload.exp === 'number' && payload.exp > nowSeconds
    return valid ? payload : null
  } catch {
    return null
  }
}

