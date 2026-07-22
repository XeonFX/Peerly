import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseRelayTicketSecrets, verifyRelayTicket } from '../../server/relayTicket.mjs'

function ticket(secret: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

describe('relay tickets', () => {
  const secrets = parseRelayTicketSecrets('relay-eu.example=eu-secret,relay-us.example=us-secret')

  it('accepts a live ticket only on its bound hostname', () => {
    const value = ticket('eu-secret', { v: 1, aud: 'relay-eu.example', sub: 'device', exp: 101 })
    expect(verifyRelayTicket(value, 'relay-eu.example', secrets, 100)).toMatchObject({ sub: 'device' })
    expect(verifyRelayTicket(value, 'relay-us.example', secrets, 100)).toBeNull()
  })

  it('rejects expired, tampered, malformed, and static legacy tokens', () => {
    const expired = ticket('eu-secret', { v: 1, aud: 'relay-eu.example', sub: 'device', exp: 100 })
    expect(verifyRelayTicket(expired, 'relay-eu.example', secrets, 100)).toBeNull()
    expect(verifyRelayTicket(`${expired}tampered`, 'relay-eu.example', secrets, 99)).toBeNull()
    expect(verifyRelayTicket('old-static-token', 'relay-eu.example', secrets, 99)).toBeNull()
  })
})

