import {
  assess, describe as describeBudget, shouldNotify,
} from '../packages/core/dist/usageBudget.js'

/**
 * A cron worker that reads the account's own Cloudflare analytics and shouts
 * before a daily free-tier budget is gone.
 *
 * This exists because of how 2026-08-02 was discovered. A client bug spent the
 * whole Worker request allowance, the Durable Object request allowance and
 * sixty times the rows-read allowance between 07:00 and 09:00 UTC, and the
 * first signal was a quota email the next day. Every fix in that incident was
 * cheap; the twelve hours of not knowing were not.
 *
 * Deliberately a separate Worker rather than a `scheduled` handler bolted onto
 * an app: the budgets are account-wide, so one watcher covers both apps and
 * keeps this off the request path of either.
 *
 * Costs: one invocation per cron tick and one subrequest. No Durable Objects —
 * a watcher that spent the budget it watches would be a poor joke.
 */

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'

const QUERY = `query Usage($account: String!, $since: Time!, $sinceHour: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $since }) {
        sum { requests }
      }
      durableObjectsInvocationsAdaptiveGroups(limit: 1000, filter: { datetimeHour_geq: $sinceHour }) {
        sum { requests }
      }
      durableObjectsPeriodicGroups(limit: 1000, filter: { datetimeHour_geq: $sinceHour }) {
        sum { rowsRead }
      }
    }
  }
}`

const startOfUtcDay = now => `${now.toISOString().slice(0, 10)}T00:00:00Z`

const total = (rows, field) =>
  (rows ?? []).reduce((sum, row) => sum + (row?.sum?.[field] ?? 0), 0)

/** Reads today's usage. Throws rather than guessing: a watcher that silently
 *  reports zero is indistinguishable from a quiet day. */
export async function readUsage(env, now = new Date()) {
  const since = startOfUtcDay(now)
  const response = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { account: env.CF_ACCOUNT_ID, since, sinceHour: since },
    }),
  })
  if (!response.ok) throw new Error(`analytics HTTP ${response.status}`)

  const body = await response.json()
  if (body.errors?.length) throw new Error(`analytics: ${body.errors[0].message}`)
  const account = body.data?.viewer?.accounts?.[0]
  if (!account) throw new Error('analytics returned no account')

  return {
    workerRequests: total(account.workersInvocationsAdaptive, 'requests'),
    durableObjectRequests: total(account.durableObjectsInvocationsAdaptiveGroups, 'requests'),
    durableObjectRowsRead: total(account.durableObjectsPeriodicGroups, 'rowsRead'),
  }
}

/**
 * Remembers the level each metric was last reported at, so a budget parked at
 * 60% alerts once rather than every tick. Kept in KV when it is bound; without
 * it the watcher still works and simply repeats itself, which is the right way
 * round for an alerting path.
 */
async function previousLevels(env, utcDate) {
  if (!env.USAGE_STATE) return {}
  try {
    return (await env.USAGE_STATE.get(`levels:${utcDate}`, 'json')) ?? {}
  } catch {
    return {}
  }
}

async function rememberLevels(env, utcDate, findings) {
  if (!env.USAGE_STATE) return
  const levels = Object.fromEntries(findings.map(finding => [finding.metric, finding.level]))
  // Expire a day after the budget it describes; yesterday's levels are noise.
  await env.USAGE_STATE.put(`levels:${utcDate}`, JSON.stringify(levels), { expirationTtl: 172_800 })
    .catch(() => {})
}

async function notify(env, message) {
  // Always log: with Workers observability on, this is queryable even when no
  // webhook is configured, and it is what `wrangler tail` shows.
  console.error(message)
  if (!env.USAGE_ALERT_WEBHOOK) return
  try {
    await fetch(env.USAGE_ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
  } catch (error) {
    console.error('usage watch: webhook delivery failed', String(error))
  }
}

export async function checkBudgets(env, now = new Date()) {
  const utcDate = now.toISOString().slice(0, 10)
  const sample = await readUsage(env, now)
  const findings = assess(sample)
  const seen = await previousLevels(env, utcDate)

  if (!shouldNotify(findings, seen)) return { findings, notified: false }

  await notify(env, describeBudget(findings, utcDate))
  await rememberLevels(env, utcDate, findings)
  return { findings, notified: true }
}

export default {
  async scheduled(_controller, env, ctx) {
    if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
      // Loud rather than silent: an unconfigured watcher looks exactly like a
      // quiet account, which is the failure this whole worker exists to avoid.
      console.error('usage watch: CF_ANALYTICS_TOKEN or CF_ACCOUNT_ID is not set; no check ran')
      return
    }
    ctx.waitUntil(checkBudgets(env).catch(error => {
      console.error('usage watch: check failed', String(error))
    }))
  },

  /** Manual trigger, for confirming the thing works without waiting for cron. */
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/check') return new Response('Not found', { status: 404 })
    try {
      const { findings, notified } = await checkBudgets(env)
      return Response.json({ notified, findings })
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 })
    }
  },
}
