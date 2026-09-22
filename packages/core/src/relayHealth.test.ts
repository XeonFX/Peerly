import { beforeEach, describe, expect, it } from 'vitest'
import { createRelayHealth } from './relayHealth.js'
import { publishRealtimeTransportState } from './realtime/liveness.js'

/**
 * The connection indicator polls this. Getting it wrong for a strategy does
 * not break the connection — it tells the user their working session is
 * offline, which is worse than a visible failure because there is nothing to
 * investigate.
 */
describe('createRelayHealth', () => {
  beforeEach(() => {
    publishRealtimeTransportState('offline')
  })

  describe('durable objects', () => {
    const health = () => createRelayHealth('durable-objects')

    it('is offline before the control socket is ready', () => {
      expect(health().isRelayOnline()).toBe(false)
      expect(health().getConnectedRelayUrls()).toEqual([])
    })

    it('is online once the control socket is ready', () => {
      // This strategy has no relay sockets at all, so the previous
      // implementation asked the Nostr socket map, found none, and reported
      // "Signaling offline" for the entire life of a working session.
      publishRealtimeTransportState('ready')
      expect(health().isRelayOnline()).toBe(true)
      expect(health().getConnectedRelayUrls()).toEqual(['durable-objects-control'])
    })

    it.each(['enrolling', 'session', 'connecting', 'backoff', 'upgrade-required'] as const)(
      'stays offline while merely %s',
      state => {
        // Real progress, but nothing can be signalled through it yet.
        publishRealtimeTransportState(state)
        expect(health().isRelayOnline()).toBe(false)
      }
    )
  })

  it('treats supabase as always reachable', () => {
    const health = createRelayHealth('supabase')
    expect(health.isRelayOnline()).toBe(true)
    expect(health.getConnectedRelayUrls()).toEqual(['supabase-realtime'])
  })

  it('reports no relays when a socket-based strategy has none open', () => {
    expect(createRelayHealth('nostr').isRelayOnline()).toBe(false)
  })
})
