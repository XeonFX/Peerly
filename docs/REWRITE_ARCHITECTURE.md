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
- **TURN smoke** — `probeTurnCapability` with `iceTransportPolicy: 'relay'`
  against real coturn, on a schedule. Two browsers on one host connect over
  host candidates and never exercise TURN; only this catches a bad TURN URL,
  an expired credential, or a down VPS.

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
   - ☐ 5d — the browser half (recipe below), then cut over and delete the
     legacy gateway, its tests, and the `gateway_kind` migration column.
6. ✅ Every module the two apps duplicated is now one module in core plus a
   per-app configuration. See below for what that turned up.
7. ☐ The remaining product code in each app, which is not duplicated.

Steps 1–5 are the shared foundation and are prerequisites for 6 and 7.

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

### 5d — the browser harness, precisely

The server half (5c) proves authentication and the control plane. What it
cannot reach is the browser: `RealtimeClient`, Trystero, and ICE. That needs
two real contexts, and the recipe is fixed by what 5c established:

1. **Target**: `wrangler dev -c wrangler.preview.jsonc`, which gives real
   Durable Objects, real SQLite and real alarms on localhost.
2. **Identity**: the generic `oidc` provider, exactly as in
   `twoAccount.workers.test.mjs` — `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_ISSUER`
   and `OIDC_JWKS_URL` set **only** in the E2E environment, with the JWKS
   served from a fixture emitted into `dist/` by the E2E build. Production
   sets none of them, so the provider resolves to `null` and the route 503s.
   Test-only auth stays configuration, never a code branch.
3. **Client wiring**: the E2E credential provider returns
   `providerId: 'oidc'` and a token whose `nonce` is the device key id — the
   binding the worker enforces. HeyHubs' existing `e2eKeys.ts` already fixes a
   keypair for exactly this reason: two browser contexts must agree on one
   issuer key.
4. **Contexts**: two Playwright contexts with independent storage, so each
   derives its own device key and therefore its own opaque account.
5. **Assertions**: the product loops, not the plumbing — two users match on a
   shared interest; one creates a room and the other's arrival is visible to
   the creator; a blocklist prevents a match; revoking a device drops the
   other session.

**What it still will not prove.** Two Chromium contexts on one host connect
over host candidates and never exercise TURN. A bad TURN URL, an expired
credential or an unreachable coturn are invisible to it. That needs a separate
scheduled check calling `probeTurnCapability` with
`iceTransportPolicy: 'relay'` against the real server — cheap, no second user,
and the only thing that catches the class of failure that prompted this
rewrite.
