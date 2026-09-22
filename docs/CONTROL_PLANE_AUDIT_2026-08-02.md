# Durable Objects control plane — cost, correctness & abuse audit

Date: 2026-08-02
Status: all findings resolved (see the resolution table at the end)
Scope: `@peerly/core` control plane, Peerly and HeyHubs workers, both on
`durable-objects-control-plane` ([Peerly#92](https://github.com/XeonFX/Peerly/pull/92),
[HeyHubs#73](https://github.com/XeonFX/HeyHubs/pull/73))
Against: `DURABLE_OBJECTS_ARCHITECTURE.md`, `DURABLE_OBJECTS_IMPLEMENTATION.md`,
HeyHubs `docs/DURABLE_OBJECTS_MIGRATION.md`

Supersedes the 2026-07-24 structural audit and the 2026-07-23 closeouts. Those
asked whether the boundary between the two apps was clean; it now is, and the
questions that remain are about **what the control plane costs and who can make
it cost more**.

## Why this audit exists

On 2026-08-02 the account's Durable Objects free-tier limit (100k requests/day)
was exhausted by a preview deployment nobody was using. Zone analytics for
06:00–09:00 UTC:

| Requests | Status | Path |
| --- | --- | --- |
| 225,802 | 500 | `/api/network/session` |
| 172,034 | 500 | `/api/network/enroll` |
| 59,798 | **200** | `/api/network/session` |
| 971 | 101 | `/api/realtime/control` |

The 59,798 *successful* session establishments in one hour — against 971
WebSocket upgrades — are the finding. The cause was a client that started a new
connection cycle for every queued command while a retry was already armed
(fixed in `c80f235`), but the incident exposed a control plane with **no ceiling
of its own**: nothing between a misbehaving client and the account quota.

Every finding below is about that gap.

## Fixed before this audit

| Change | Effect |
| --- | --- |
| `c80f235` | `connect()` is idempotent while a retry is armed; one retry chain, equal-jitter backoff, reset only after a stability window |
| `c5c5c6c` | Alarm prune no longer scans the event table (`rows × keepNewest` reads → one indexed lookup); 300M SQL rows read in a day was this |
| `1758655` | Deltas batch per `batchWindowMs`, with app-declared urgent kinds; the constants had been declared and unread |
| HeyHubs `4487404` | A match reservation no longer overwrites the seek lease, so an abandoned commit returns the account to seeking instead of dropping it |

Everything below was found by this audit and has since been fixed. The findings
are kept in full because the reasoning is the useful part: each one records why
the control plane had no ceiling of its own, which is the property worth
preserving as it grows.

## Findings

### C1 — `/api/network/enroll` and `/api/network/session` have no rate limit. **Highest priority.**

The only rate limiter in either deployment is `RENDEZVOUS_RATE_LIMITER`
(`wrangler.preview.jsonc:41`), used solely by `packages/core/worker/rendezvous.mjs:63`.
HeyHubs' `wrangler.preview.jsonc` declares no `ratelimits` block at all.

Both auth endpoints perform **two Durable Object RPCs each** before any
throttle could apply (`worker/realtime/auth.mjs:91,94` and `:153,156`), so an
unthrottled client converts one HTTP request into two billed DO requests. This
is the control that would have capped the incident regardless of the client
bug, and it is the one control that is missing.

**Proposal.** Bind a rate limiter on both paths, keyed by device key with an IP
fallback, at a limit derived from the legitimate ceiling — a healthy client
calls `session` once per `sessionRefreshMs` (200s) and `enroll` approximately
never. Something like 10/60s per device is two orders of magnitude above normal
use and still caps a runaway client at a few thousand requests a day.

### C2 — A Durable Object failure surfaces as an unhandled 500

`gateway.consumeNonce(...)` and friends are awaited with no `try`/`catch`
(`auth.mjs:91`), so a DO error — quota exhaustion, an overloaded object, a
transient runtime fault — propagates out of `fetch` and Cloudflare returns 500.
The client maps any non-`ok`, non-401 response to `failed` and retries
(`adapters/browser/index.ts:86`). It does not read `Retry-After`; nothing does.

The result is that the *symptom* of an overloaded control plane is a stampede
against it. Hour 08:00 on 2026-08-02 was 195,185 requests and zero successes.

**Proposal.** Catch DO failures at the route boundary and answer `503` with
`Retry-After`; honour that header in `RealtimeClient.scheduleReconnect()` as a
floor on the next delay. The backoff fix bounds this to one chain per client;
this bounds it across clients, which is what turns a partial outage into a
recoverable one.

### C3 — Any authenticated account can write into any other account's stream

`invite.send` and `ring.send` take `to` as an arbitrary bounded string
(`protocol/commands.ts:94,111`) and deliver straight to that account's gateway
(`app/coreHandlers.ts:62,80`). There is no relationship, capability or consent
check. Three consequences compound:

- **Mailbox eviction.** `deliverToAccount` drops the oldest entry once
  `mailboxEntries` (100) is reached (`coreHandlers.ts:125`). At the sustained
  command rate (5/s) a sender clears a victim's mailbox of genuine invites in
  about twenty seconds.
- **Quota.** Each delivery is a DO request against the *account-wide* limit, so
  one authenticated socket can spend ~432k DO requests/day and three sockets
  can spend the whole deployment's budget several times over.
- **Discoverability.** The opaque user id is not enumerable, but HeyHubs hands
  it to every match partner permanently: `match.commit` carries
  `peer.opaqueUserId` (`worker/realtime/commands/discovery.mjs:225`). Anyone
  you have ever matched with can do the above indefinitely.

**Proposal.** Gate both commands. The cheapest correct version is a
short-lived, server-issued delivery capability naming the recipient — the same
shape as the rendezvous capability already used for friend invites — so
`to` stops being a client-chosen parameter. Failing that, per-recipient rate
limiting plus refusing to evict *unread* invites from unknown senders removes
the two sharp edges without a protocol change.

### C4 — The room directory is polled, and each poll is two DO requests

`DO_ROOMS_REFRESH_MS = 30_000` (`src/coordination.ts:31`) issues
`directory.list` on a timer. Each is a socket message to `UserGatewayDO` plus an
RPC to `RoomDirectoryShardDO` — 2 DO requests, 5,760/day per tab sitting on the
lobby.

`REWRITE_ARCHITECTURE.md` already records `directory.change` as the push that
retires this poll, deliberately deferred past cutover. This audit raises its
priority: it is the single largest per-tab cost in the system.

### C5 — `controlSocketsPerAccount` is also the device limit

`registerSession` passes `LIMITS.controlSocketsPerAccount` as
`decideEnrollment`'s `maxDevices` (`adapters/durableObject/gatewayRuntime.ts:187`;
`domain/deviceRegistry.ts:34`). Two unrelated ceilings share one constant set to
3: how many tabs may hold a socket, and how many devices an account may enrol.
Three devices is low for a real user — phone, laptop, desktop, work laptop
already evicts — and raising the socket allowance to fix that would silently
raise the device allowance too.

**Proposal.** Split into `controlSocketsPerAccount` and `devicesPerAccount`.
`limits.enforcement.test.ts` will require a test for the new key, which is the
right forcing function.

### C6 — Socket eviction closes one socket and can oscillate

`accept()` closes `open[0]` when the count reaches the limit
(`gatewayRuntime.ts:134`) — one socket, even if the object holds many, and the
new socket is accepted regardless, so the count can exceed the cap. Because the
victim is the *oldest* rather than the *incoming* connection, a fourth tab
evicts the first, whose client reconnects and evicts the second.

The backoff fix bounds the oscillation (repeated short-lived sockets now
escalate rather than reset), but the mechanism remains. Hibernated sockets from
closed tabs count toward the total until the runtime reaps them, so the limit
binds sooner than a user would expect.

**Proposal.** Close every socket above the cap, and reject the incoming upgrade
with a retryable code once the account is genuinely at its ceiling, rather than
displacing a healthy connection.

### C7 — Steady-state cost per tab

Measured from the constants, with no user activity at all:

| Source | Interval | Was | Now |
| --- | --- | --- | --- |
| Session refresh | 200s → 10 min | 864 | 144 |
| Presence lease renewal (alarm + `PresenceStats`) | 30 min | 96 | 96 |
| **Idle connected tab** | | **~960** | **~240** |
| HeyHubs directory (poll → watch renewal) | 30s → 7.5 min | 5,760 | 384 |
| **Idle HeyHubs lobby tab** | | **~6,720** | **~624** |

The session refresh halved twice over: `cookieTtlMs` went from 10 to 30 minutes
(C7) and the two RPCs behind it became one (C8). The directory line is now a
lease renewal rather than a poll, plus one push per change window when the
listing actually moves (C4).

Plus `/api/stats/snapshot`, which is per-colo cached (`statsCacheSeconds` 10,
`presenceStats.mjs:72`) and so costs ~8,640/day per colo rather than per tab.

At 100k/day free tier that is roughly **13 concurrent lobby tabs**. Addressing
C4 raises it to about 90; addressing C4 and the session-refresh cost together
raises it past 250.

**Proposal.** `cookieTtlMs` is 10 minutes and the refresh runs at a third of it.
Raising the cookie to 30 minutes cuts the refresh to 144/day; folding the nonce
consumption into the same RPC (C8) halves it again.

### C8 — Two DO RPCs where one would do

Both auth handlers call the same object twice in sequence: `consumeNonce` then
`registerSession`, or `consumeNonce` then `validateSession`. Two billed
requests, two round trips, for one logical operation on one object.

**Proposal.** A single `establishSession({ nonceHash, expiresAt, uid, sid, dk,
epoch })` returning both outcomes halves the cost of the hottest path in the
system and removes a window where the nonce is spent but the session was never
validated.

### C9 — Minor

- `mailbox.oldestId()` orders by `created_at` with no index
  (`sqlGatewayStorage.ts:188`). Bounded at 100 rows, so this is tidiness.
- `connect()` resolves even when the cycle failed, so `createDurableObjectsCoordinator`
  reports `available: true` on a transport that never connected
  (`coordination.ts:550`). Cosmetic today because the indicator re-reads state,
  but it makes the status event untrustworthy as a signal.
- `createDurableObjectsCoordinator.close()` does not close the transport
  (`coordination.ts:617`). Correct as written — the transport is a per-app
  singleton shared with signalling — but worth a comment saying so, because it
  reads as an omission.

## Verified clean

- No credentials or secrets in logs or URLs anywhere reviewed.
- Hibernation discipline is correct: `ctx.acceptWebSocket`, serialized
  attachments, alarm-based expiry, in-memory maps treated as caches. The one
  new timer (delta batching) is a bounded 75 ms flush, never an interval.
- Inbound `x-realtime-*` headers are stripped before trusted values are stamped
  (`worker/realtime/router.mjs:12`).
- Origin is enforced on both auth endpoints and both upgrade routes.
- `device.revoke` takes the account from the socket, never a parameter.
- The app boundary the 2026-07-24 audit was written about holds: HeyHubs-only
  classes live in HeyHubs, and the shared gateway takes app commands by
  injection rather than a switch.

## Resolution

| # | Severity | Resolved by |
| --- | --- | --- |
| C1 | Critical | `AUTH_RATE_LIMITER` bound in all four wrangler configs and enforced in `handleEnroll`/`handleSession` before any work. Open when unbound — a cost control, not an authorization one. |
| C3 | High | Per-recipient token bucket on `invite.send`/`ring.send`, and a full mailbox now refuses rather than evicting an unread invite. The sender is told `cap-exceeded` instead of being told it was delivered. |
| C2 | High | Gateway failures are caught at the route boundary and answered `503` with `Retry-After`; the client reads the header and uses it as a floor on the next backoff. |
| C4 | High | `directory.watch`/`directory.unwatch` with a `directoryWatchTtlMs` lease. The shard coalesces changes for `directoryChangeWindowMs` and pushes one `directory.change`; the client reads once in response and falls back to polling where the deployment cannot push. |
| C8 | Medium | `enrollDevice` and `openSession` replace the `consumeNonce` + `registerSession`/`validateSession` pairs — one request each, and no window where the nonce is spent but no session exists. |
| C5 | Medium | `devicesPerAccount` (4) split from `controlSocketsPerAccount` (3). |
| C6 | Medium | `accept()` closes every socket above the ceiling, not just the first. |
| C7 | Medium | `cookieTtlMs` 10 → 30 minutes; `sessionRefreshMs` still derives from it. Revocation is unaffected: a socket is admitted against the session epoch in storage, not the cookie's lifetime. |
| C9 | Low | `mailbox_created` index; `available` now follows the transport's `state` event instead of `connect()` resolving; the shared-singleton reason `close()` does not close the transport is written down. |

### Known gap

`limits.ts` claims `limits.enforcement.test.ts` fails for any constant nothing
enforces. That file does not exist. It is the guard that would have caught the
batching constants sitting unread for a release, and it is worth building —
tracked separately, since it is a test-infrastructure change rather than one of
the findings above.
