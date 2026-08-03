import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkBudgets, readUsage } from './usageWatch.mjs'

/**
 * The watcher's own failure modes matter more than most code's, because it is
 * the thing that tells you everything else broke. A watcher that silently
 * reports zero is indistinguishable from a quiet account — which is precisely
 * the state that let 2026-08-02 run for twelve hours unnoticed.
 */

const graphqlResponse = ({ workers = 0, doRequests = 0, rowsRead = 0 }) => ({
  ok: true,
  json: async () => ({
    data: {
      viewer: {
        accounts: [{
          workersInvocationsAdaptive: [{ sum: { requests: workers } }],
          durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: doRequests } }],
          durableObjectsPeriodicGroups: [{ sum: { rowsRead } }],
        }],
      },
    },
  }),
})

const baseEnv = { CF_ANALYTICS_TOKEN: 'token', CF_ACCOUNT_ID: 'acct' }

let originalFetch
let errors

beforeEach(() => {
  originalFetch = globalThis.fetch
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')))
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('readUsage', () => {
  it('sums every row rather than reading only the first', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            accounts: [{
              workersInvocationsAdaptive: [{ sum: { requests: 10 } }, { sum: { requests: 32 } }],
              durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 5 } }],
              durableObjectsPeriodicGroups: [{ sum: { rowsRead: 7 } }, { sum: { rowsRead: 8 } }],
            }],
          },
        },
      }),
    })
    expect(await readUsage(baseEnv)).toEqual({
      workerRequests: 42, durableObjectRequests: 5, durableObjectRowsRead: 15,
    })
  })

  it('asks only for today, so yesterday cannot mask a fresh spike', async () => {
    let sent
    globalThis.fetch = async (_url, init) => {
      sent = JSON.parse(init.body)
      return graphqlResponse({})
    }
    await readUsage(baseEnv, new Date('2026-08-02T13:45:00Z'))
    expect(sent.variables.since).toBe('2026-08-02T00:00:00Z')
    expect(sent.variables.sinceHour).toBe('2026-08-02T00:00:00Z')
  })

  it('throws on a GraphQL error rather than reporting zero usage', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ errors: [{ message: 'unknown field' }] }),
    })
    await expect(readUsage(baseEnv)).rejects.toThrow(/unknown field/)
  })

  it('throws on an HTTP failure rather than reporting zero usage', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 403 })
    await expect(readUsage(baseEnv)).rejects.toThrow(/403/)
  })

  it('throws when the account is missing from the response', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { viewer: { accounts: [] } } }) })
    await expect(readUsage(baseEnv)).rejects.toThrow(/no account/)
  })
})

describe('checkBudgets', () => {
  it('says nothing on an ordinary day', async () => {
    globalThis.fetch = async () => graphqlResponse({ workers: 900, doRequests: 700, rowsRead: 40_000 })
    const result = await checkBudgets(baseEnv)
    expect(result.notified).toBe(false)
    expect(errors).toEqual([])
  })

  it('reports the incident shape loudly', async () => {
    globalThis.fetch = async () =>
      graphqlResponse({ workers: 483_180, doRequests: 264_600, rowsRead: 300_018_783 })
    const result = await checkBudgets(baseEnv)
    expect(result.notified).toBe(true)
    expect(errors.join('\n')).toContain('EXHAUSTED')
  })

  it('posts to the webhook when one is configured', async () => {
    const posted = []
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('example.com')) {
        posted.push(JSON.parse(init.body))
        return { ok: true, json: async () => ({}) }
      }
      return graphqlResponse({ workers: 90_000 })
    }
    await checkBudgets({ ...baseEnv, USAGE_ALERT_WEBHOOK: 'https://example.com/hook' })
    expect(posted[0].text).toContain('workerRequests')
  })

  /** A webhook outage must not stop the log line; the log is the floor. */
  it('still logs when webhook delivery fails', async () => {
    globalThis.fetch = async url => {
      if (String(url).includes('example.com')) throw new Error('unreachable')
      return graphqlResponse({ workers: 90_000 })
    }
    await checkBudgets({ ...baseEnv, USAGE_ALERT_WEBHOOK: 'https://example.com/hook' })
    expect(errors.join('\n')).toContain('CRITICAL')
    expect(errors.join('\n')).toContain('webhook delivery failed')
  })

  it('alerts once per level rather than on every tick', async () => {
    const store = new Map()
    const env = {
      ...baseEnv,
      USAGE_STATE: {
        get: async key => (store.has(key) ? JSON.parse(store.get(key)) : null),
        put: async (key, value) => { store.set(key, value) },
      },
    }
    globalThis.fetch = async () => graphqlResponse({ workers: 60_000 })

    expect((await checkBudgets(env)).notified).toBe(true)
    expect((await checkBudgets(env)).notified).toBe(false)
  })

  it('alerts again when a metric climbs into the next level', async () => {
    const store = new Map()
    const env = {
      ...baseEnv,
      USAGE_STATE: {
        get: async key => (store.has(key) ? JSON.parse(store.get(key)) : null),
        put: async (key, value) => { store.set(key, value) },
      },
    }
    let workers = 60_000
    globalThis.fetch = async () => graphqlResponse({ workers })

    expect((await checkBudgets(env)).notified).toBe(true)
    workers = 85_000
    expect((await checkBudgets(env)).notified).toBe(true)
  })
})
