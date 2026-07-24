import { describe, expect, it } from 'vitest'
import { CLIENT_LIMITS } from './limits.js'
// Excluded from the tsc build (tsconfig `exclude: ["src/**/*.test.ts"]`), so
// this file is free to reach outside `src/` — plain Vitest/esbuild has no
// rootDir restriction, only `tsc -b` does. This is what makes it possible to
// mechanically guarantee CLIENT_LIMITS can't silently drift from LIMITS
// despite the two files having no import relationship at build time.
import { LIMITS } from '../../worker/realtime/limits.mjs'

const SHARED_KEYS = [
  'protocolVersion', 'controlFrameBytes', 'signalFrameBytes',
  'interestsPerSeek', 'directoryPageEntries', 'statsMinPollMs',
] as const

describe('CLIENT_LIMITS stays in sync with the server LIMITS it mirrors', () => {
  it.each(SHARED_KEYS)('%s matches worker/realtime/limits.mjs', key => {
    expect(CLIENT_LIMITS[key]).toBe(LIMITS[key])
  })
})
