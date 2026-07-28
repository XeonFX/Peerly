# Rewrite architecture

Status: in progress. Supersedes the layering decisions in
`DURABLE_OBJECTS_ARCHITECTURE.md` (which remains authoritative on *why*
Durable Objects, the cost model, and the rollout phases).
Date: 2026-07-25
Applies to: `@peerly/core`, Peerly, HeyHubs

## What this rewrite is for

Three goals, in priority order:

1. **A boundary that holds structurally.** `@peerly/core` must contain no
   concept that belongs to one app. Today the leak is small but real: the
   shared `UserGatewayDO` hardcodes `seek.*` and `directory.*` command
   handlers, which only HeyHubs uses, and six comments in core name HeyHubs.
   Comments are cosmetic; the hardcoded handlers are the actual coupling.
2. **The audit findings designed out, not patched.** Every finding in
   `DURABLE_OBJECTS_AUDIT.md` is either fixed by construction here or listed
   below with the invariant that makes it unrepresentable.
3. **Clean architecture in the sense that pays**: pure domain logic with no
   platform imports, explicit ports, thin adapters. Not layering for its own
   sake — the test is whether a rule can be unit-tested without a Durable
   Object, a WebSocket, or a browser.

## What this rewrite must not lose

The existing code encodes expensive, non-obvious knowledge that no amount of
restructuring rediscovers for free. Each of these is a bug that was found the
hard way, and each must survive the rewrite with its explanation attached:

- The media-push glare guard (lexicographically smaller peer publishes first)
  — Chrome↔Firefox renegotiation dies with `InvalidAccessError` otherwise.
- Host-succession settle windows and lowest-peer-id tie-break — without them
  two peers elect different winners.
- NFKC normalization can *expand* a string past a length cap already checked.
- `iceCandidatePoolSize` must stay unset; Trystero already pools offers.
- Five or more ICE servers slows gathering and trips a Firefox warning.
- `ctx.id.name` is `undefined` inside a Durable Object, even via `getByName`.
- TURN URLs are passed exactly as configured; rewriting ports assumes an
  nginx SNI map that is per-hostname.

**Rule: no behavioural comment is deleted without either carrying it forward
or writing a test that would fail if the behaviour regressed.**

## Layering

```
packages/core/src/
  protocol/     pure: wire contract, limits, frame codec, command registry
  domain/       pure: rules with no I/O (matching, presence, succession, ids)
  ports/        interfaces the domain needs (Clock, Store, Signer, Transport)
  adapters/     implementations: durable-object storage, browser websocket, webcrypto
  app/          composition roots wiring the above
```

Dependency rule, enforced by a lint boundary test: `protocol` and `domain`
import nothing from `adapters`, `app`, or any platform global. `ports` import
only from `protocol`/`domain`. Adapters may import anything.

`protocol/` is the single source of truth for the wire contract and is
imported by **both** the browser client and the Worker. The previous split
(`worker/realtime/limits.mjs` + a hand-mirrored `src/realtime/limits.ts`,
`protocol.mjs` + `protocol.ts`) existed only because `tsc --rootDir src`
refused to reach into `worker/`. That is a build-configuration problem, and
the rewrite solves it in the build config rather than by duplicating
security-relevant constants — audit findings C1 and C2.

## The app boundary

Core defines the **universal** command set: `hello`, `resume`,
`scope.request`, `scope.leave`, `invite.send`, `invite.ack`, `ring.send`,
`device.revoke`. These are meaningful for any app built on the control plane.

Everything else is registered by the app:

```ts
// HeyHubs composition root
const commands = coreCommands().extend([seekStart, seekCancel, directoryPublish, ...])
```

`UserGatewayDO` receives its command registry rather than containing a
`switch`. Consequences:

- Core stops shipping matchmaking and room-directory code that Peerly deploys
  inert (audit A2).
- The `seek` table, the match reservation RPCs, and the directory helpers move
  to HeyHubs beside `InterestQueueDO`, which already lives there (audit A1).
- Adding a command is one registry entry with its own validator, not an edit
  to a closed `switch` in shared code.

## Invariants that make audit findings unrepresentable

| Finding | Invariant |
| --- | --- |
| Identity from `ctx.id.name` | A Durable Object never derives identity from its own id. Identity arrives as a typed `Identity` value on every entry point, and the constructor cannot produce one. |
| G1 command-id collision | Frame ids are minted by one `IdSource` port seeded with per-client entropy; the timestamp+counter format is deleted. |
| G3 empty seek | `SeekRequest` is constructed through a factory that rejects an empty interest set, so an empty seek has no representation. |
| G4 silent handler throw | The dispatcher owns the try/catch and always answers: ack, typed error, or `internal`. Handlers cannot return nothing. |
| G2 unused limits | Every limit has a call site with a test asserting enforcement. A limit with no enforcement test fails the suite. |
| G6 directory cap | Per-owner quota checked in the same statement that inserts. |
| C1 duplicated limits | One `limits.ts`, imported by both runtimes. |
| Blocklist id-space | Exclusions and member ids are a distinct `MemberId` branded type; passing an `OpaqueUserId` where a `MemberId` is expected does not compile. |

## Verification, and why it comes before the interesting parts

The failures that motivated this rewrite were not caught by 634 passing unit
tests, because none of them exercised two users through the real client path.
So the harness is part of the foundation, not a follow-up:

- **Unit** — pure `protocol`/`domain`, no platform.
- **Workers** — DO behaviour against real workerd (`vitest-pool-workers`).
- **Two-user E2E** — `wrangler dev` with real DO bindings + two Playwright
  contexts with independent storage, authenticated through the generic `oidc`
  provider against a locally served JWKS. Test-only auth is *configuration*
  (`VITE_OIDC_*` unset in production ⇒ provider resolves to `null`), never a
  code branch that could ship enabled.
- **TURN smoke** — `npm run turn:smoke -- turn:host:3478 turns:host:5349`.
  Two browsers on one host connect over host candidates and never exercise
  TURN; only this catches a bad TURN URL, a rotated secret, or a down VPS. It
  asks coturn for a real allocation over each transport rather than driving
  WebRTC, so it needs no browser, no signed-in session and no second user.
  `probeTurnCapability` remains the in-app version, for telling *a user* about
  *their* network.

## Migration order

Each step lands green and deployable; the previous implementation keeps
serving until its replacement passes the same tests.

1. ✅ `protocol/` — limits, frame codec, command registry, ids.
2. ✅ `domain/` — rate limiting, device registry, event stream, presence.
3. ✅ `ports/` + `adapters/` — memory and SQLite storage behind one contract,
   the gateway command loop, the Durable Object runtime.
4. ✅ Gateway on the injected registry; the discovery commands now live in the
   HeyHubs repository and are registered at composition time.
5. Verification.
   - ✅ 5a/5b — the rewritten gateway runs in real workerd, composed by both
     apps, with two accounts matched end to end through the interest queue.
   - ✅ 5c — two identities through the real routes: OIDC enrolment, session,
     authenticated control socket, no hand-written account ids.
   - ✅ 5d — the browser half: two real contexts against a real gateway.
6. ✅ Every module the two apps duplicated is now one module in core plus a
   per-app configuration. See below for what that turned up.
7. ☐ Ship it. See "What is left" — the rewrite is not finished when the code
   is clean, it is finished when it is serving traffic.

Steps 1–5 are the shared foundation and are prerequisites for 6 and 7.

## What is left

**Production still runs `COORDINATION_BACKEND: "legacy-relay"`.** Everything
above exists only on preview. Ordered by risk carried, not by effort.

### A — close the verification gap, before anything ships

| | Work | Why it is first |
| --- | --- | --- |
| A1 | ✅ HeyHubs browser harness (`npm run test:integration:do`) | This app's half of the control plane — the interest queue, the room directory, presence stats — had never run in a browser, and Peerly deploys most of it inert. Standing it up found the provider id hardcoded to `'google'` in four more places, which is invisible while there is one provider and stops a matched pair connecting the moment there are two. |
| A2 | ✅ TURN smoke test (`npm run turn:smoke -- <urls>`) | Speaks TURN directly rather than through a browser, so it runs on a schedule with no page, no session and no second user. **Verified end to end against the live server** on 2026-07-28: real allocations over both 3478/udp and 5349/tls, with the certificate validated. It immediately earned itself — coturn's shared secret had been rotated without the workers being updated, which breaks TURN in both apps on *both* the legacy and Durable Objects paths, invisibly: users behind a strict NAT simply fail to connect. Nothing else in either repo can see that. |
| A3 | ✅ Pairing, sync and revocation in the harness | Two contexts on one account with different device keys: they pair, exchange grants, sync, and revoke. One assertion per sync rule — a value the other device lacks arrives, a preference it already chose is left alone, and a key no rule names does not travel. That last one is what closing the allow-list was for. |

### B — production cutover

| | Work | Note |
| --- | --- | --- |
Written up step by step, with verification and rollback, in
**`DURABLE_OBJECTS_CUTOVER.md`**. It is a runbook rather than a prepared
commit for a concrete reason: a branch carrying DO migrations fails to build
from the moment it is pushed, because Workers Builds deploys non-production
branches with `versions upload` and Cloudflare rejects versions containing a
migration (10211). So B1 is applied in its own PR and merged promptly, never
staged ahead of time.

| | Work | Note |
| --- | --- | --- |
| B1 | ☐ Bindings + `migrations` into `wrangler.jsonc` | Own PR per app, `COORDINATION_BACKEND` unchanged. Creates the namespaces and changes no behaviour, which is what makes it safe to land alone. |
| B2 | ☐ Flip `COORDINATION_BACKEND` per app | Peerly first: it uses less of the control plane, so a fault there is cheaper to read. Legacy relay keeps serving until the flip holds. |
| B3 | ☐ Delete the legacy relay path | Only after B2 holds. Removing it first leaves nothing to roll back to. |

### C — designed but unbuilt

From the audit's own open list. None is reachable-but-wrong; all are declared
and never implemented.

- ✅ **`WorkspaceDO` — deleted**, along with the `workspace.presence` delta
  kind that existed only for it. It was unreachable, and wiring it up would
  have put workspace membership and presence on the server, which is the
  opposite of what this product is. Removing it now is free because
  production has no tag history yet; preview takes a `realtime-v2` tag with
  `deleted_classes`. Adding a class back later is one tag — removing a live
  one is not, which is why this came before B1.
- ✅ The four delta kinds nothing emitted — `invite.acked`, `seek.state`,
  `directory.change`, `sync.notice` — are out of `RealtimeDeltaEvent`. Each
  was an impossible case that every exhaustive handler carried and no test
  could reach. A type union is a claim about what the system does; intentions
  belong in this file.
- ✅ The `bye` frame the audit recorded as missing **exists**: `encodeBye` in
  `protocol/frames.ts`, sent by `app/gatewayService.ts` on malformed frames,
  version mismatch and typed errors, handled in `app/realtimeClient.ts`. It
  was built during the rewrite; the audit entry was stale.
- ☐ `directory.change` — the push that would retire the room-directory poll
  (30s per visible tab), and polling is what drives DO request count.
  Deliberately **after** the cutover: shipping a new push mechanism in the
  same release that moves the control plane gives one symptom two suspects,
  and the traffic that would show whether it helped does not exist yet.
- ☐ `invite.send`/mailbox is built and tested server-side but has no client
  caller — Peerly delivers friend invites peer-to-peer over the presence
  lobby. Built-and-unused, not declared-and-missing, so it costs a registry
  entry and nothing else. Left alone.

### D — remaining product code, deliberately scoped down

The original step 7 read "rewrite the remaining product code" — about 19.6k
lines in Peerly and 15.2k in HeyHubs.

**That is not worth doing wholesale, and this records why.** The driver for
the de-duplication pass was two copies drifting apart; every one of those is
now a single module plus configuration. What remains is per-product code that
works. Rewriting it trades known behaviour for unknown risk and buys style.

What was worth it, on its own merits rather than as part of a rewrite — the
three files doing too much, where new bugs would land:

- ✅ Peerly `App.tsx`, 410 → 309. Out came `useSessionBootstrap` (the one
  effect answering what this browser already knows about who is signed in,
  across four eras of how that was stored), `useWorkspaceNavigation` (the
  four actions that change session and route together — getting one right
  and not the other is how you render a workspace that is no longer open),
  and `shouldRaiseNotification`, now testable without a browser.
- ✅ HeyHubs `App.tsx`, 626 → 556. Out came `useDmRingToasts` (one toast per
  conversation out of a stream of identical rings) and `useRandomChat`
  (start, match, and resume-after-refresh — the last matters because the
  view survives a reload and the seek does not).
- ✅ HeyHubs `ProfilePage.tsx`, 552 → 492. Out came `useBlocklistSharing`
  and `useProfileEditor`.

Two bugs surfaced in the writing rather than the reading: the blocklist
feedback timers were never cancelled on unmount, and a first pass at the
broadcast-avatar switch would have persisted the previous value through a
stale closure. Both are the kind that only appear once the logic is stated
plainly enough to look at.

The rest waits for a reason.

## What the de-duplication pass found

Each duplicated module was reconciled to the stricter of the two behaviours
rather than to whichever was shorter. Most pairs agreed on the mechanism and
disagreed on a guard — and a missing guard is a bug in the app that missed it,
not a style difference. What is genuinely app-owned is now explicit and small:
a scheme, a storage key, wording, styling.

Bugs this surfaced, each fixed for both apps:

| Area | What was wrong |
|---|---|
| Device sync | The key list was a deny-list, so every key a future feature invents synced by default. This browser's own peer ids were being copied between machines. Now closed and stated key by key, and re-checked on the way in. |
| DM ring | One app accepted a ring only from the exact device recorded at friending time, so the moment a friend added a second device their DMs stopped ringing — silently. |
| Approved-device sync | One app never checked how old a hello was, so a captured one stayed good forever. |
| Connectivity pill | One app asked only the local probe, which cannot see a strict NAT or a firewall, and so reported "supported" on the very networks where nothing connects. |
| Friends list | One app let you befriend yourself; a DM credential could outlive the friendship that justified it. |
| Device grants | Key, id and signature lengths were unbounded before reaching the crypto layer. |
| Avatars | Adopting an inline avatar fetched whatever it was handed, so an https URL would have reached its host. |
| Scan cadence | One app had two modules exporting the same two names with different values, and the one under test was not the one in use. |

Two pairs share a filename and nothing else — `useAppRouting` and
`profileStore`. One app routes screens of a workspace and the other rooms of a
lobby; one keeps a single profile and the other per-account extras. Only the
address-bar plumbing under `useAppRouting` was ever common, and that is what
was lifted. Forcing the rest together would be an abstraction over nothing.

### 5d — the browser harness

✅ `npm run test:e2e:do`. The server half (5c) proved authentication and the
control plane; this reaches what it could not — `RealtimeClient`, Trystero and
ICE in a real browser.

1. **Target**: `wrangler.e2e.jsonc` under `wrangler dev`, giving real Durable
   Objects, real SQLite and real alarms on localhost. The worker serves a
   *build*, not a dev server, so what the suite drives is the artefact a
   deployment would serve.
2. **Identity**: the generic `oidc` provider — `VITE_OIDC_CLIENT_ID`,
   `VITE_OIDC_ISSUER` and `OIDC_JWKS_URL` set only in that config, with the
   JWKS emitted into `dist/` after the build. Browser and worker then verify
   through the same real fetch. A deployment that sets none of them resolves
   the provider to `null` and the route 503s, so test-only auth stays
   configuration rather than a code branch.
3. **Origin**: the harness names its own in `E2E_ALLOWED_ORIGIN`, matched as
   one exact string. Production sets nothing and allows nothing extra.
4. **Contexts**: two Playwright contexts with independent storage, so each
   derives its own device key and its own opaque account.
5. **Assertions**: the product loops, not the plumbing. Nothing reaches into
   a socket or asserts on a frame.

It earned its keep immediately. The connection indicator polls a relay-socket
map that this transport does not populate, so the app displayed "Signaling
offline" for the entire life of a working session and held
`useConnectionHealth` in a permanent error state. Every request succeeded. No
existing test could see it: the workers suite has no UI, the unit suite has no
transport, and the other browser suite runs on ws-relay.

**What it still will not prove.** Two Chromium contexts on one host connect
over host candidates and never exercise TURN. A bad TURN URL, an expired
credential or an unreachable coturn are invisible to it — which is why
`wrangler.e2e.jsonc` deliberately configures no TURN at all rather than
offering one the test cannot reach. That needs a separate scheduled check
calling `probeTurnCapability` with `iceTransportPolicy: 'relay'` against the
real server: cheap, no second user, and the only thing that catches the class
of failure that prompted this rewrite.
