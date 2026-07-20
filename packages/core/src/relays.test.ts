import { describe, expect, it } from 'vitest'
import { expandTurnUrls, getIceServers, getTurnConfig } from './relays.js'

describe('getIceServers', () => {
  it('returns undefined without TURN so Trystero keeps its own defaults', () => {
    expect(getIceServers({})).toBeUndefined()
    expect(getIceServers({ VITE_TURN_URLS: '   ' })).toBeUndefined()
  })

  it('pairs one fallback STUN with the configured TURN (never five-plus)', () => {
    const servers = getIceServers({
      VITE_TURN_URLS: 'turn:turn.example:3478,turns:turn.example:5349',
      VITE_TURN_USERNAME: 'user',
      VITE_TURN_CREDENTIAL: 'pass',
    })
    expect(servers).toHaveLength(2)
    expect(servers?.[0].urls).toEqual(['stun:stun.l.google.com:19302'])
    expect(servers?.[1]).toEqual({
      urls: [
        'turn:turn.example:3478',
        'turn:turn.example:3478?transport=udp',
        'turn:turn.example:3478?transport=tcp',
        'turns:turn.example:5349?transport=tcp',
        'turns:turn.example:443?transport=tcp',
        'turns:turn.example:5349',
      ],
      username: 'user',
      credential: 'pass',
    })
  })

  it('keeps getTurnConfig TURN-only while adding resilient transports', () => {
    const turn = getTurnConfig({ VITE_TURN_URLS: 'turn:turn.example:3478' })
    expect(turn).toHaveLength(1)
    expect(turn?.[0].urls).toEqual([
      'turn:turn.example:3478',
      'turn:turn.example:3478?transport=udp',
      'turn:turn.example:3478?transport=tcp',
      'turns:turn.example:5349?transport=tcp',
      'turns:turn.example:443?transport=tcp',
    ])
  })

  it('does not rewrite custom TURN ports', () => {
    expect(expandTurnUrls(['turns:[2001:db8::1]:9443?transport=tcp'])).toEqual([
      'turns:[2001:db8::1]:9443?transport=tcp',
    ])
  })
})
