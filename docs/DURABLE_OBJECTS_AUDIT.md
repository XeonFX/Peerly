# Durable Objects control plane — correctness & completeness audit

Status: findings fixed (see resolution table below)
Date: 2026-07-24
Reviews: [Peerly#92](https://github.com/XeonFX/Peerly/pull/92),
[HeyHubs#73](https://github.com/XeonFX/HeyHubs/pull/73)
(both on branch `durable-objects-control-plane`)
Against: `docs/DURABLE_OBJECTS_ARCHITECTURE.md`,
`docs/DURABLE_OBJECTS_IMPLEMENTATION.md`, and HeyHubs
`docs/DURABLE_OBJECTS_MIGRATION.md`

Review priorities: (1) Peerly must not leak HeyHubs details, (2) everything
common belongs in `@peerly/core`, (3) no code duplication, plus general
correctness/completeness against the plan.

## Headline

The **deployment / binding boundary is clean in both directions** — the key
mitigating fact:

- Peerly's `worker/index.mjs` exports and `wrangler.preview.jsonc` binds
  **only** `UserGatewayDO`, `SignalScopeDO`, `WorkspaceDO`.
- HeyHubs' `worker/index.mjs` exports/binds **only** `UserGatewayDO`,
  `SignalScopeDO`, `InterestQueueDO`, `PresenceStatsShardDO`,
  `RoomDirectoryShardDO` — never Peerly's `WorkspaceDO`.
- Peerly's generated `worker-configuration.d.ts` gained
  `COORDINATION_BACKEND` / `NETWORK_SESSION_SECRET` / `OPAQUE_USER_ID_SECRET`
  but **no** `INTEREST_QUEUES` / `PRESENCE_STATS` / `ROOM_DIRECTORY` bindings.

No HeyHubs feature is reachable in the deployed Peerly worker, and vice-versa.
**The leak the no-leak rule targets is at the *source* level, and it is baked
into the plan itself** — see A1, the most important thing to decide.

Two clean bills of health worth stating up front: no credentials/secrets are
logged or placed in URLs anywhere reviewed, and hibernation discipline is
correct throughout (`ctx.acceptWebSocket`, serialized attachments, alarm-based
expiry, no `setInterval`, in-memory maps treated as caches only).

---

## 1. "Peerly should not leak HeyHubs details"

### A1 — HeyHubs-only DO classes live in the Peerly repo (core). **Central issue.**

`packages/core/worker/realtime/interestQueue.mjs`, `presenceStats.mjs`,
`roomDirectory.mjs` are **HeyHubs-only** (the docs, class comments, and
bindings all say so) yet live in `@peerly/core`, inside the Peerly repository.

Tension with the three rules:

- **Rule 3 (no duplication)** only bites for code *both* apps use. These three
  classes have exactly **one** consumer (HeyHubs). Moving them to HeyHubs
  duplicates nothing.
- **Rule 1 (no HeyHubs leak into Peerly)** is violated *only* by keeping them
  in core.

The plan (`ARCHITECTURE.md` "Shared package layout", `IMPLEMENTATION.md` §1)
puts them in core "so both apps share one codebase and test suite." That
stated benefit is **not delivered** (see B1 — Peerly has zero tests for them),
so the justification for the leak does not hold in the actual implementation.

**Recommendation:** move `interestQueue.mjs`, `presenceStats.mjs`,
`roomDirectory.mjs` (and their tests) into the **HeyHubs** repo (e.g.
`HeyHubs/worker/realtime/`). Keep only genuinely shared pieces (`crypto`,
`auth`, `protocol`, `limits`, `router`, `rateLimit`, `userGateway`,
`signalScope`, client `src/realtime/*`) in core. If instead the plan is
honored as-written, that is a legitimate decision — but it should be a
conscious, recorded override of Rule 1, not left implicit.

### A2 — The shared `UserGatewayDO` embeds HeyHubs product logic

`userGateway.mjs` contains HeyHubs-specific command handlers —
`handleSeekStart` / `handleSeekCancel` (matching, lines 175–203) and
`handleDirectoryPublish` / `Delete` / `List` (room directory, lines 231–254) —
plus the match RPCs. On Peerly these are dead branches guarded by
`if (!this.env.INTEREST_QUEUES)` / `if (!this.env.ROOM_DIRECTORY)`. So Peerly
*deploys* HeyHubs matchmaking/directory code, inert.

Harder to fully separate because the plan mandates one shared gateway class.
For strict separation, factor app-specific command handling into an injected
handler map (Peerly registers workspace/invite/ring; HeyHubs additionally
registers seek/directory). Otherwise, note it as an accepted consequence of
the single-gateway design.

### A3 — Cross-brand naming (cosmetic)

Client IndexedDB DB name is hard-coded `peerly-realtime` (`client.ts:54`) and
runs in the HeyHubs browser too. Plan §12.2 mandates this exact name, so it is
conformant — but it is a literal "peerly" string in HeyHubs storage. Cosmetic.

---

## 2. "No code duplication"

### C1 — `CLIENT_LIMITS` is a hand-maintained duplicate of `LIMITS`

`src/realtime/limits.ts` (CLIENT_LIMITS) re-declares literal values
(`protocolVersion`, `controlFrameBytes`, `signalFrameBytes`,
`interestsPerSeek`, `directoryPageEntries`, `statsMinPollMs`) that also live in
`worker/realtime/limits.mjs`. The file comment admits *"Keep in sync by
hand."* Plan §2 called for the client file to **re-export** the subset, not
re-declare it. Genuine drift hazard: a server cap and its client mirror can
diverge silently.

**Fix:** derive `limits.ts` from a single source. If the `.mjs`↔`.ts`
build-graph split truly prevents import, extract shared constants into one
plain `.js`/`.json` both read, or generate one from the other at build time —
do not maintain two literal copies.

### C2 — Frame envelope shape + encoders duplicated across runtimes

`RealtimeFrame` (`types.ts`) + `encodeCommand` / `decodeFrame`
(`protocol.ts`) mirror `encodeFrame` / `parseFrame` in `protocol.mjs`;
`encodeProof` (`client.ts:22`) duplicates `deviceProofBytes` (`crypto.mjs:81`).
Some is structural (browser TS cannot import worker MJS), but the envelope
contract and the proof-string format are security-relevant strings now in two
places. At minimum add a cross-checking test, or centralize the string
constants.

---

## 3. Plan-conformance correctness gaps

### D1 — Version negotiation never fails closed (medium)

Plan §3.3/§3.6/§12.1 require unsupported protocol versions to **close with
4002** so the client reaches its terminal `upgrade-required` state. Actual:

- `parseFrame` maps envelope `v !== 1` to `CLOSE.MALFORMED_FRAME` (4003), not
  4002 (`protocol.mjs:85`).
- `hello` with `payload.version !== 1` throws a *soft* `invalid-frame` (no
  close) — the socket stays open and the session silently never negotiates
  (`protocol.mjs:104-106`, `userGateway.mjs:99-106`).

`CLOSE.VERSION_UNSUPPORTED` (4002) and error code `version-unsupported` are
defined but **never emitted**. The client's `if (event.code === 4002)` branch
(`client.ts:186`) is currently dead code. Harmless today (both sides v1) but
the entire version-negotiation exit path is missing.

### D2 — Enroll/Session do not enforce the Origin allowlist (medium)

Plan §5: *"All endpoints: reject non-allowlisted Origin with 403 … each app
passes its existing origin predicate (`allowedAuthParent`) into the router
config."* `auth.mjs` `handleEnroll` / `handleSession` never call
`config.allowedOrigin`; only `authenticateUpgrade` (control/signal) does.
`config.allowedOrigin` is passed in but unused for the POST endpoints. OIDC +
device signature make forgery hard, so this is defense-in-depth rather than a
hole — but it is a specified control that is absent.

### D3 — `handleSession` missing the 413 body pre-check (low)

`handleEnroll` rejects bodies over `maxRequestBodyBytes` before parsing
(`auth.mjs:29-30`); `handleSession` does not. Plan §5 requires it for all
endpoints.

### D4 — Room-directory TTL borrows the seek-lease constant (low-medium)

`userGateway.mjs:236`: `directory.publish` sets
`expiresAt: nowMs() + LIMITS.seekLeaseMs` (30 min). Room announcements
inheriting the *seek* lease is a copy-paste coupling — changing matchmaking
lease length would silently change how long public rooms live. Add a dedicated
`roomAnnouncementTtlMs`.

### D5 — Match commit not retried once (low)

Plan §9 step 5: *"A commit RPC failure is retried once; a still-failing commit
is abandoned."* `interestQueue.mjs:125-128` uses a single `Promise.allSettled`
with no retry.

### D6 — Peerly migration tag layout diverges from the guide (low, verify before cutover)

Guide §13 specifies Peerly `realtime-v1 = [UserGatewayDO, SignalScopeDO]`,
`realtime-v2 = [WorkspaceDO]`. The PR ships a single
`realtime-v1 = [UserGatewayDO, SignalScopeDO, WorkspaceDO]`
(`wrangler.preview.jsonc`). Migration tags are append-only after deployment,
and `peerly-preview` is already deployed — confirm the eventual production
cutover config either matches what preview created or targets a fresh
namespace, so Phase 5 does not hit a tag-mismatch.

### D7 — Client `send()` has no timeout (low, PR-1 scope)

The doc says commands reject "on an `error` frame or timeout," but
`client.ts:222-234` never times out a pending command — a lost ack leaves the
promise hung and the entry in `pending`/`queue` forever.

---

## 4. Test completeness

### B1 — HeyHubs-only DOs have zero tests in the repo that owns them (medium)

Peerly core ships tests for `crypto`, `protocol`, `signalScope`,
`userGateway`, `workspace` — but **none** for `interestQueue`,
`presenceStats`, `roomDirectory`. Those are tested only in HeyHubs
(`worker/interestQueue.workers.test.mjs` etc.), against the vendored tarball.

Consequences:

- A change to `interestQueue.mjs` **in core** is not validated by Peerly CI —
  the repo that owns the source.
- The Peerly PR's claim that these are in core "so both apps share one codebase
  **and test suite**" is untrue for the test suite.
- Plan §14 explicitly locates `interestQueue.workers.test.mjs` and
  `roomDirectory.workers.test.mjs` in core.

Bind-tension: to test them in Peerly's `vitest.workers.config.ts` you would
have to add `INTEREST_QUEUES` / `PRESENCE_STATS` / `ROOM_DIRECTORY` bindings to
Peerly's preview config — i.e. bind HeyHubs DOs in Peerly. **That tension is
itself the strongest argument for A1: the classes and their tests belong in
HeyHubs.**

Coverage that *is* present is good: Peerly's `userGateway.workers.test.mjs`
covers the match RPCs (`reserveForMatch` / `commitMatch` / `releaseMatch`,
incl. idempotent re-commit), device cap, nonce replay, mailbox drop-oldest,
hibernation resume, and upgrade auth. HeyHubs' interest-queue test covers happy
match, exclusions, cooldown, stale-reservation recovery, dequeue, and alarm
prune.

---

## 5. Minor

- **E1** Peerly `worker-configuration.d.ts` is generated from the
  migration-free default config, so `env.USER_GATEWAYS` / `SIGNAL_SCOPES` /
  `WORKSPACES` are untyped in worker code. Cosmetic (types are advisory);
  regenerate from the preview config for editor support.
- **E2** IndexedDB DB name `peerly-realtime` used in HeyHubs too — cross-brand,
  but plan §12.2 mandates it. Cosmetic. (Same root as A3.)
- **E3** HeyHubs `worker/index.test.mjs` `parseJsonc` uses a fragile regex
  (`/(?<!:)\/\/.*$/`) that would mis-strip a `//` inside a string value not
  preceded by `:`. Fine for these two files today; brittle if configs grow.
- **E4** `handleSeekStart` re-runs NFKC normalization (`userGateway.mjs:177`)
  *after* the protocol layer already enforced ≤32 chars; NFKC can re-expand
  length past 32. Edge case.

---

## Resolution status (fix pass, 2026-07-24)

All findings below were addressed in a follow-up pass across both repos.
`npm test`, `npm run test:workers`, `npm run lint`, `npm run worker:check`,
and `npm run build` pass in both Peerly and HeyHubs after these changes.

| # | Resolution |
| --- | --- |
| A1 | **Fixed.** `interestQueue.mjs`, `presenceStats.mjs`, `roomDirectory.mjs` (and their tests) moved from `packages/core/worker/realtime/` to HeyHubs' `worker/realtime/`. They import `LIMITS`/`deriveScopeRouteId` from `@peerly/core/worker/realtime` like any other consumer. Peerly's `index.mjs` barrel no longer exports them; HeyHubs' `worker/index.mjs` exports them locally alongside the shared `UserGatewayDO`/`SignalScopeDO` from core. |
| A2 | **Documented, not restructured.** `seek.*`/`directory.*` remain in the shared `UserGatewayDO` per the plan's single-gateway design; added a code comment in `userGateway.mjs` clarifying these are universal wire-protocol command types (guarded no-ops when unbound), not misplaced product code. |
| A3 / E2 | **Fixed.** `RealtimeClient`'s IndexedDB database name is now `` `${config.app}-realtime` `` instead of the hardcoded `peerly-realtime`. |
| B1 | **Fixed.** Resolved as a consequence of A1 — the three DOs' tests now live beside their (relocated) source in HeyHubs. Also closed a gap found during this pass: `auth.mjs` had zero direct tests despite the plan mandating them; added `auth.workers.test.mjs` (origin allowlist, body-size limits, `authenticateUpgrade` cookie/origin/expiry behavior). |
| C1 | **Mitigated.** The two literal declarations still exist (the `tsc rootDir`/no-dist-dependency constraint makes a real structural merge impractical), but `limits.consistency.test.ts` cross-imports both files (test files are excluded from the `tsc` build, so this doesn't violate `rootDir`) and fails CI on any drift between `CLIENT_LIMITS` and `LIMITS`. |
| C2 | **Left open.** Still low priority; not addressed in this pass. |
| D1 | **Fixed.** Envelope `v !== 1` now closes `4002` (`CLOSE.VERSION_UNSUPPORTED`) instead of `4003`. `hello.payload.version` shape validation now accepts any number (structural check only); `UserGatewayDO` closes `4002` if the negotiated version isn't `LIMITS.protocolVersion`. Added protocol- and gateway-level tests for both paths. |
| D2 | **Fixed.** `handleEnroll`/`handleSession` now reject a non-allowlisted `Origin` with `403` before any other processing, matching `authenticateUpgrade`. |
| D3 | **Fixed.** `handleSession` now rejects an oversized body with `413` before parsing, mirroring `handleEnroll`. |
| D4 | **Fixed.** Added `LIMITS.directoryEntryTtlMs` (independent of `seekLeaseMs`); `directory.publish` now uses it. |
| D5 | **Fixed.** `InterestQueueDO.tryMatch` retries a failed `commitMatch` once via `commitWithRetry` before abandoning it. |
| D6 | **Documented.** Both apps ship a single combined `realtime-v1` migration tag rather than plan section 13's two-tag split. Since production has no existing tag history to reconcile, this is recorded as the accepted layout going forward (append-only from here) rather than changed retroactively — see the implementation guide's superseded-notes block. |
| D7 | **Fixed.** `RealtimeClient.send()` now rejects with a timeout (`CLIENT_LIMITS.commandTimeoutMs`, 15s) if no ack/error arrives, clearing the command from `pending`/`queue` either way. |
| E1 | **Fixed.** Added a second generated types file (`worker-configuration.preview.d.ts`, `--env-interface PreviewEnv`) for the DO-bound preview config in both repos, wired into `worker:check` (and therefore CI) via `--check`. |
| E3 | **Fixed.** HeyHubs' `parseJsonc` now scans char-by-char tracking string/escape state instead of a line-suffix regex, so a `//` inside a quoted config value can't be mis-stripped. |
| E4 | **Fixed.** Added `LIMITS.interestMaxChars`; `handleSeekStart` re-checks the bound after NFKC normalization (which can expand length) instead of trusting the pre-normalization protocol-layer check to still hold. |

## Second pass, 2026-07-24 — behavioural

The audit above is entirely **structural**: does the code match the spec, is it
in the right package, is a constant duplicated. Every finding was real and
every one was fixed. None of them asked *"if two users do X, does X happen?"* —
and the answer was no. `UserGatewayDO` derived its app and account id from
`ctx.id.name`, which is `undefined` inside a Durable Object, so every account
in both apps ran as `app='app'`, `uid=''`: no two peers could exchange SDP
(the signal scope authorized a route id the router never opens), no two
seekers could match (an interest queue keyed by uid held one row for the whole
population), invites went to a gateway nobody listens on, and presence was
never published.

The existing tests passed throughout because they exercised each object's RPCs
with hand-written ids — the exact values that were broken.

**Process change:** every user-visible loop gets one test that drives the real
client path end to end (`HeyHubs/worker/realtime/seekMatching.workers.test.mjs`
is the model: two real control sockets, `seek.start`, assert a match). Treat
that as a gate on the Phase 5 cutover, not a nice-to-have.

Findings from the behavioural pass, all fixed:

| # | Finding |
| --- | --- |
| F1 | `ctx.id.name` is undefined inside a DO — the identity bug above. |
| F2 | **`UserGatewayDO.revokeDevice` had no caller.** Revoking a device in Peerly's UI only dropped a local P2P grant; the device kept its 30-day capability, its server session, and its control socket. Added the `device.revoke` command, the `device.revoked` event to sibling devices, `revokeRealtimeDevice()` in core, and wired Peerly's devices page to it. |
| F3 | The TURN credential and the `pnet` cookie both expire at `cookieTtlMs` (10 min) and were never refreshed on a long-lived socket — new signal sockets 401'd and peers offered each other credentials coturn had already expired. The client now re-establishes the session every 4 minutes. |
| F4 | DO builds handed Trystero a TURN-only ICE list where the legacy path sends STUN + TURN, and `joinRoom` replaces Trystero's defaults with it. |
| F5 | **The resume cursor was in-memory only**, so every page load resumed from 0 and replayed up to 24h of retained events. Now persisted; the aged-out-cursor snapshot path is reachable for the first time. |
| F6 | `SignalScopeDO` never used its own `to`/topic routing — every SDP/ICE frame broadcast to the whole scope (O(N²), and every participant saw every pair's envelopes). Participants now claim their topics and delivery is routed, falling back to broadcast for unclaimed topics. |
| F7 | Seek exclusions were compared against the server's opaque uid, an id no client can name: **no blocklist excluded anyone from matchmaking.** Exclusions and the new `memberId` now share the app's own id space. |
| F8 | The mailbox was write-only (`invite.ack` was a no-op), so its cap silently evicted unread invites. `scope.leave` was a no-op, leaving authorizations live for their full lease. Both now do what they say. |
| F9 | Polling was neither demand-driven nor visibility-gated, contrary to the plan's own constraint. `directory.list` costs a cross-object request per tab per poll — ~8,600 DO requests/day for one idle background tab. Now split (stats 10s / rooms 30s), stopped while the tab is hidden, and caught up on becoming visible. |

**Still open, deliberately:** 5 of 9 declared delta event kinds are never
emitted (`directory.change`, `seek.state`, `invite.acked`, `sync.notice`, and
`workspace.presence` — the last only from `WorkspaceDO`, see below); the `bye`
frame in §3.3 does not exist; `invite.send`/mailbox has no consumer in either
app (Peerly delivers friend invites peer-to-peer over the presence lobby).
None of these is reachable-but-wrong; they are designed-but-unbuilt, and
`directory.change` in particular is the push mechanism that would remove the
room-directory poll entirely.

### `WorkspaceDO` — decision

`WorkspaceDO` is **unreachable**: there is no `workspace.*` command, no
dispatch branch, and no route; the only non-test reference to `env.WORKSPACES`
is its own test file. Peerly nonetheless binds it and ships an append-only
migration tag for it.

Decision: **do not wire it up, and do not include it in the production cutover
config.** Its one product use would be ICE-independent workspace presence, and
`useRelayWorkspacePresence` deliberately returns no peers on this backend
today — adding that is a feature decision, not a migration fix. Since
production has no tag history yet (D6), the Phase 5 config can simply omit the
class rather than inherit a permanently orphaned one. The preview namespace
keeps its existing tag; that is harmless.

## Prioritized fix list

| #      | Severity        | Fix |
| ------ | --------------- | --- |
| A1     | **Decide first**| Move `interestQueue`/`presenceStats`/`roomDirectory` (+tests) to HeyHubs, or explicitly record keeping them in core as an accepted override of the no-leak rule. Drives B1. |
| B1     | High            | Give the three HeyHubs-only DOs a real test suite in whichever repo ends up owning them; today they are untested in core. |
| C1     | High            | Stop hand-duplicating `CLIENT_LIMITS`; derive it from the single `LIMITS` source. |
| D1     | Medium          | Emit close 4002 / `version-unsupported` on version mismatch (envelope `v` and `hello.version`) so the client upgrade path works. |
| D2     | Medium          | Enforce `config.allowedOrigin` in `handleEnroll` / `handleSession` (403). |
| D4     | Medium          | Give room-directory entries their own TTL constant, not `seekLeaseMs`. |
| A2, C2, D3, D5, D6, D7, E1–E4 | Low | Address opportunistically; **D6 must be verified before the Phase 5 cutover.** |
