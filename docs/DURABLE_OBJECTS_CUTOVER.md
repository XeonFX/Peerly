# Durable Objects cutover runbook

Status: not started. Production runs `COORDINATION_BACKEND: "legacy-relay"`.
Applies to: Peerly, HeyHubs
Companion to: `REWRITE_ARCHITECTURE.md` (what was built), `DURABLE_OBJECTS_AUDIT.md` (what was found)

Everything the control plane needs is built and verified on preview. This is
the sequence that puts it in front of users, and the sequence matters more
than any individual step.

## Why this is a runbook and not a commit

The bindings and migrations **cannot live on a feature branch**, which is why
no branch in this repository contains them and why this file exists instead.

Workers Builds deploys every non-production branch with `wrangler versions
upload`, and Cloudflare rejects any version carrying a Durable Object
migration — API error 10211. A branch with `migrations` in `wrangler.jsonc`
fails to build from the moment it is pushed, and keeps failing until it
merges. Migrations apply only through a full deploy, which happens on merge to
`main`.

So step 1 is written here, applied in its own pull request, and merged
promptly. It is not staged in advance.

## Before starting

- [ ] `npm run test:e2e:do` green (Peerly) and `npm run test:integration:do`
      green (HeyHubs). These are the only tests that exercise a browser
      against a real gateway.
- [ ] `npm run turn:smoke -- turn:turn.peerly.cc:3478 turns:turn.peerly.cc:5349`
      green **with the real `TURN_AUTH_SECRET`** (and the same for
      `turn.heyhubs.app`). A dummy secret proves everything up to the
      credential comparison and stops there — a wrong secret and a wrong
      signature both return 401, so only this run distinguishes them.
- [ ] `TURN_AUTH_SECRET` on all four workers matches coturn's
      `static-auth-secret`. **Rotating it on the VPS breaks TURN in both apps
      with no visible error** — users behind a strict NAT simply fail to
      connect — and it signs on both the legacy relay path
      (`/api/network/credentials`) and the Durable Objects one
      (`/api/network/session`), so a stale secret is not a cutover-only
      problem. Worker secrets cannot be read back, so re-set all four rather
      than trying to diff them:

      ```
      npx wrangler secret put TURN_AUTH_SECRET                            # peerly
      npx wrangler secret put TURN_AUTH_SECRET -c wrangler.preview.jsonc  # peerly-preview
      ```

      and the same two in HeyHubs. This happened on 2026-07-28; the smoke test
      found it in a second, which is the argument for running it on a schedule
      rather than before cutovers only.

### Changing a production secret while a branch is open

`wrangler secret put` on a production Worker fails with *"the latest version of
your Worker isn't currently deployed"* for as long as an unmerged branch
exists. Workers Builds uploads every non-production branch with `versions
upload`, so the newest version is branch code while the deployed one is from
`main`.

**Do not reach for `wrangler versions secret put` here.** It creates a new
version inheriting from that branch upload. It does not fix production — the
version is not deployed — and it leaves a version that ships the whole branch
the moment anyone runs `versions deploy`.

Two safe routes:

- **The dashboard** — Workers & Pages → the Worker → Settings → Variables and
  Secrets → edit. Applies against the deployed version, no ambiguity.
- **Deploy `main` first**, then `wrangler secret put` behaves normally.

Preview Workers are deployed by hand rather than by Workers Builds, so their
latest *is* their deployed version and `secret put -c wrangler.preview.jsonc`
works throughout.

The ambiguity disappears once the branch merges, which is another reason B1
wants merging promptly rather than sitting open.
- [ ] Production secrets exist on both workers: `TURN_AUTH_SECRET`,
      `RENDEZVOUS_SECRET`, `NETWORK_SESSION_SECRET`, `OPAQUE_USER_ID_SECRET`.
      `wrangler secret list` per app. A missing `NETWORK_SESSION_SECRET` or
      `OPAQUE_USER_ID_SECRET` makes every enrolment 503 — the control plane
      does not start degraded, it does not start.

## Step 1 — bindings and migrations into `wrangler.jsonc`

One pull request per app, containing nothing else. Merge it promptly rather
than letting it sit: while it is open its branch build fails, by design.

`COORDINATION_BACKEND` stays `"legacy-relay"`. This step creates the Durable
Object namespaces and changes no behaviour — nothing routes to them yet, which
is exactly what makes it safe to do first and separately.

Peerly, into `wrangler.jsonc`:

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "USER_GATEWAYS", "class_name": "UserGatewayDO" },
    { "name": "SIGNAL_SCOPES", "class_name": "SignalScopeDO" }
  ]
},
"migrations": [
  { "tag": "realtime-v1", "new_sqlite_classes": ["UserGatewayDO", "SignalScopeDO"] }
]
```

HeyHubs additionally binds `INTEREST_QUEUES` (`InterestQueueDO`),
`PRESENCE_STATS` (`PresenceStatsShardDO`) and `ROOM_DIRECTORY`
(`RoomDirectoryShardDO`), all five in the same `realtime-v1` tag. Copy them
from `wrangler.preview.jsonc`, which is the tested shape.

**`WorkspaceDO` is not in either list, and must not be added.** It was deleted
for being unreachable; preview carries a `realtime-v2` tag that removes it.
Production has no history to unwind, so it simply never has it. A class in an
applied migration is permanent.

Also delete the "no `durable_objects`/`migrations` may appear in this file"
comment as part of this PR — once merged it is false, and a stale warning is
worse than none.

Verify after merge:

- [ ] `npx wrangler deploy --dry-run` clean for both apps.
- [ ] The namespaces exist in the dashboard.
- [ ] Production still serves normally. Nothing should have changed.

## Step 2 — flip Peerly

`COORDINATION_BACKEND: "durable-objects"` and `VITE_SIGNALING=durable-objects`
in the build command.

**Peerly first, deliberately.** It uses less of the control plane — no
matchmaking, no room directory, no presence stats — so a fault there is
cheaper and easier to read than the same fault under HeyHubs' traffic.

Watch, in this order, because this is the order they fail in:

1. `/api/network/enroll` returning 200. A 503 means a missing secret; a 403
   means the origin allow-list does not cover the deployed hostname.
2. `/api/realtime/control` sockets staying open. Repeated close 4002 means a
   protocol version mismatch between a cached bundle and the new worker.
3. The connectivity indicator reading online rather than "Signaling offline".
   That exact wording was a real bug — a working session reporting itself
   down — and its return means the transport is not reaching `ready`.
4. TURN. Two users on different networks, not two tabs: two tabs on one host
   connect over host candidates and prove nothing about a relay.

Rollback is `COORDINATION_BACKEND: "legacy-relay"` and a redeploy. The legacy
relay is still running and still serving; that is the whole reason step 4
exists and comes last.

## Step 3 — flip HeyHubs

Same change, once Peerly has held for a few days of real use.

Additionally watch matchmaking: two strangers with a shared interest should
match within seconds. The interest queue is the busiest object in the system
and the one with no equivalent in Peerly, so it gets its own soak.

## Step 4 — retire the legacy relay

Only after both apps have held. Removing it first would leave nothing to roll
back to, which turns a bad afternoon into an outage.

- [ ] `COORDINATION_BACKEND` and the relay branch deleted from both apps.
- [ ] `attachCoordinationServer` and the relay server removed if nothing else
      uses them.
- [ ] The VPS relay process stopped — but **not** coturn, which the Durable
      Objects path still depends on.

## What is deliberately not in this cutover

`directory.change`. The room directory is polled every 30 seconds per visible
tab, and pushing changes instead would remove that entirely. It is worth
doing, and it is worth doing *after* the flip: adding a new push mechanism to
the same release that moves the control plane means two suspects for one
symptom, and the traffic that would tell you whether it helped does not exist
until step 3 is done.
