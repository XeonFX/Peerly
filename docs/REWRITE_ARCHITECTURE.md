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

1. `protocol/` — limits, frame codec, command registry, ids. *(in progress)*
2. `domain/` — matching, succession, presence, id spaces.
3. `ports/` + `adapters/` — DO storage, browser socket, webcrypto.
4. `UserGatewayDO` on the injected registry; HeyHubs commands move out.
5. Two-user E2E harness; then cut over and delete the old realtime modules.
6. Peerly app rewrite on the new core.
7. HeyHubs app rewrite on the new core.

Steps 1–5 are the shared foundation and are prerequisites for 6 and 7.
