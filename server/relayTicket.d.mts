export type RelayTicketPayload = {
  v: 1
  aud: string
  sub: string
  exp: number
  [key: string]: unknown
}

export function parseRelayTicketSecrets(raw: string | undefined, required?: boolean): Map<string, string>

export function verifyRelayTicket(
  ticket: string,
  host: string,
  secretsByHost: ReadonlyMap<string, string>,
  nowSeconds?: number
): RelayTicketPayload | null
