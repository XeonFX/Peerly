import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLIENT_TIMINGS, LIMITS } from './limits.js'

/**
 * The guard `limits.ts` has always claimed to have.
 *
 * Its header says "adding a limit here is not enough: `limits.enforcement.test.ts`
 * fails for any key with no test proving it is enforced somewhere". That file did
 * not exist, which is exactly why the delta-batching trio shipped declared and
 * unread for a release, and why `signalSocketsPerDevice` and `attachmentBytes`
 * before them did the same.
 *
 * Two things are checked, and the second is the one that matters:
 *
 * 1. Every key is named in the registry below, so adding a constant forces a
 *    human to say where it is enforced.
 * 2. The file named in the registry actually reads the key, so a claim cannot
 *    go stale after the enforcement moves or is deleted. A registry nobody
 *    verifies is a comment.
 *
 * A key that is genuinely enforced only in a consuming app (HeyHubs owns the
 * matchmaking and directory ones) records that app's file and is exempt from
 * check 2, since this repository cannot see it. Those are listed explicitly
 * rather than pattern-matched, so the exemption stays a decision.
 */

const here = dirname(fileURLToPath(import.meta.url))
const coreRoot = join(here, '..', '..')

/** key -> the file that reads it. `null` means enforced in a consuming app. */
const ENFORCED_IN: Record<string, string | null> = {
  protocolVersion: 'src/protocol/frames.ts',
  controlFrameBytes: 'src/app/gatewayService.ts',
  signalFrameBytes: 'src/adapters/durableObject/signalScopeRuntime.ts',
  attachmentBytes: 'src/domain/signalRouting.ts',
  controlSocketsPerAccount: 'src/adapters/durableObject/gatewayRuntime.ts',
  devicesPerAccount: 'src/adapters/durableObject/gatewayRuntime.ts',
  participantsPerScope: 'src/adapters/durableObject/signalScopeRuntime.ts',
  topicsPerParticipant: 'src/domain/signalRouting.ts',

  commandsBurst: 'src/app/gatewayService.ts',
  commandsSustained: 'src/app/gatewayService.ts',
  signalsBurst: 'src/adapters/durableObject/signalScopeRuntime.ts',
  signalsSustained: 'src/adapters/durableObject/signalScopeRuntime.ts',
  deliveriesBurstPerRecipient: 'src/app/coreHandlers.ts',
  deliveriesSustainedPerRecipient: 'src/app/coreHandlers.ts',
  deliveryRecipientsTracked: 'src/app/coreHandlers.ts',

  // Matchmaking and the room directory belong to HeyHubs; core only declares
  // the numbers so both sides agree on them.
  interestsPerSeek: null,
  interestMaxChars: null,
  exclusionsPerSeek: null,
  seekLeaseMs: null,
  reservationMs: null,
  matchCooldownMs: null,
  directoryPageEntries: null,
  directoryPayloadBytes: null,
  directoryMaxRoomsPerShard: null,
  directoryMaxRoomsPerOwner: null,
  directoryEntryTtlMs: null,
  directoryWatchTtlMs: null,
  directoryWatchersPerShard: null,
  directoryChangeWindowMs: null,
  shardCount: null,

  mailboxEntries: 'src/app/coreHandlers.ts',
  idempotencyTtlMs: 'src/app/gatewayService.ts',

  eventRetentionRows: 'src/domain/eventStream.ts',
  eventRetentionMs: 'src/domain/eventStream.ts',
  batchWindowMs: 'src/adapters/durableObject/gatewayRuntime.ts',
  batchMaxEvents: 'src/domain/eventStream.ts',
  batchMaxBytes: 'src/domain/eventStream.ts',

  nonceTtlMs: 'worker/realtime/auth.mjs',
  cookieTtlMs: 'worker/realtime/auth.mjs',
  // Enforced by a Cloudflare binding, so the check is CONFIGURED_LIMITS below:
  // the wrangler config holds the number, never the constant's name.
  authRequestsPerMinute: null,
  authRequestsPerMinutePerIp: null,
  capabilityTtlMs: 'worker/realtime/auth.mjs',
  scopeAuthorizationTtlMs: 'src/app/coreHandlers.ts',

  presenceLeaseMs: 'src/domain/presence.ts',
  statsCacheSeconds: null,

  maxRequestBodyBytes: 'worker/realtime/auth.mjs',
}

/** Client pacing is enforced by the client alone. */
const CLIENT_ENFORCED_IN: Record<string, string> = {
  sessionRefreshMs: 'src/app/realtimeClient.ts',
  pingIntervalMs: 'src/app/realtimeClient.ts',
  commandTimeoutMs: 'src/app/realtimeClient.ts',
  commandQueueMax: 'src/app/realtimeClient.ts',
  reconnectBaseMs: 'src/app/realtimeClient.ts',
  reconnectCapMs: 'src/app/realtimeClient.ts',
  resumeSaveDebounceMs: 'src/app/realtimeClient.ts',
}

/**
 * The rate-limit ceilings are configuration, not code: they are enforced by a
 * Cloudflare binding declared in the wrangler config, so the check is that the
 * declared number still matches the constant.
 */
const CONFIGURED_LIMITS: Record<string, { file: string; binding: string }> = {
  authRequestsPerMinute: { file: 'wrangler.preview.jsonc', binding: 'AUTH_RATE_LIMITER' },
  authRequestsPerMinutePerIp: { file: 'wrangler.preview.jsonc', binding: 'AUTH_IP_RATE_LIMITER' },
}

const read = (relativePath: string): string => {
  const fromCore = join(coreRoot, relativePath)
  try {
    return readFileSync(fromCore, 'utf8')
  } catch {
    // Wrangler configs live at the repository root, not inside the package.
    return readFileSync(join(coreRoot, '..', '..', relativePath), 'utf8')
  }
}

describe('every declared limit is enforced somewhere', () => {
  it('names an enforcement site for every LIMITS key', () => {
    const declared = Object.keys(LIMITS).sort()
    const registered = Object.keys(ENFORCED_IN).sort()
    // A key added to `limits.ts` without a line here fails, which is the whole
    // point: the registry is the forcing function.
    expect(registered).toEqual(declared)
  })

  it('names an enforcement site for every CLIENT_TIMINGS key', () => {
    expect(Object.keys(CLIENT_ENFORCED_IN).sort()).toEqual(Object.keys(CLIENT_TIMINGS).sort())
  })

  it.each(
    Object.entries(ENFORCED_IN).filter(([, file]) => file !== null) as [string, string][]
  )('LIMITS.%s is actually read by its named file', (key, file) => {
    expect(read(file)).toContain(key)
  })

  it.each(Object.entries(CLIENT_ENFORCED_IN))(
    'CLIENT_TIMINGS.%s is actually read by its named file',
    (key, file) => {
      expect(read(file)).toContain(key)
    }
  )

  it.each(Object.entries(CONFIGURED_LIMITS))(
    'LIMITS.%s matches the limit its binding declares',
    (key, { file, binding }) => {
      const config = read(file)
      const index = config.indexOf(`"${binding}"`)
      expect(index, `${binding} is not declared in ${file}`).toBeGreaterThan(-1)
      const declared = config.slice(index).match(/"limit":\s*(\d+)/)
      expect(declared?.[1]).toBe(String(LIMITS[key as keyof typeof LIMITS]))
    }
  )
})

/**
 * The failure this whole file exists to catch: a constant read only by a
 * function that nothing calls. `shouldFlush` and `addToBatch` were implemented,
 * covered by their own unit test, and reachable from no production path for a
 * release — the constants looked enforced from every angle except the one that
 * mattered.
 */
describe('batching is reachable from the runtime, not just from its unit test', () => {
  const sourceFiles = (dir: string): string[] => {
    const entries = readdirSync(dir).map(name => join(dir, name))
    return entries.flatMap(path => {
      if (statSync(path).isDirectory()) return sourceFiles(path)
      return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
    })
  }

  it.each(['addToBatch', 'shouldFlush'])('%s is called by non-test source', helper => {
    const callers = sourceFiles(join(coreRoot, 'src'))
      .filter(path => !path.endsWith('eventStream.ts'))
      .filter(path => new RegExp(`\\b${helper}\\s*\\(`).test(readFileSync(path, 'utf8')))
      .map(path => relative(coreRoot, path))

    expect(callers.length, `${helper} is exported and tested but never called`).toBeGreaterThan(0)
  })
})
