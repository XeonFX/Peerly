import { describe, expect, it } from 'vitest'
import { APP_COMMIT, APP_VERSION, appBuildLabel, DEFAULT_NOSTR_RELAYS } from './config'

describe('build identity', () => {
  // These are compile-time constants injected by build-info.mjs. vitest does not
  // read vite.config.ts, so if the two configs ever stop sharing that helper,
  // every test importing config.ts dies on "__APP_VERSION__ is not defined".
  // This fails first, and says why.
  it('injects a semver version at build time', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('injects a commit, or a clear placeholder when git metadata is absent', () => {
    expect(APP_COMMIT === 'unknown' || /^[0-9a-f]{7,40}$/.test(APP_COMMIT)).toBe(true)
  })

  it('labels the build with version and commit', () => {
    const label = appBuildLabel()
    expect(label.startsWith(`v${APP_VERSION}`)).toBe(true)
    if (APP_COMMIT !== 'unknown') {
      expect(label).toContain(APP_COMMIT)
    } else {
      // No commit is not worth showing a dangling separator for.
      expect(label).not.toContain('·')
    }
  })
})

describe('default Nostr relays', () => {
  it('are all wss and free of duplicates', () => {
    for (const url of DEFAULT_NOSTR_RELAYS) {
      expect(url.startsWith('wss://')).toBe(true)
    }
    expect(new Set(DEFAULT_NOSTR_RELAYS).size).toBe(DEFAULT_NOSTR_RELAYS.length)
  })

  it('keeps enough redundancy that one dead relay is survivable', () => {
    // Peers only need one relay in common, but public relays disappear without
    // notice (relay.mostr.pub did, mid-deployment). `npm run check:relays`
    // verifies they actually relay ephemeral events; this only guards the floor.
    expect(DEFAULT_NOSTR_RELAYS.length).toBeGreaterThanOrEqual(3)
  })

  it('excludes relays known to be unusable for this traffic', () => {
    // damus rate-limits Trystero's ephemeral events ("noting too much");
    // mostr.pub stopped accepting connections entirely.
    expect(DEFAULT_NOSTR_RELAYS).not.toContain('wss://relay.mostr.pub')
    expect(DEFAULT_NOSTR_RELAYS).not.toContain('wss://relay.damus.io')
  })
})
