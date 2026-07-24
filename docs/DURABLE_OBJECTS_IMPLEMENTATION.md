# Durable Objects implementation guide

Status: companion to [DURABLE_OBJECTS_ARCHITECTURE.md](./DURABLE_OBJECTS_ARCHITECTURE.md)  
Date: 2026-07-23  
Audience: the engineer or coding agent implementing the plan. The architecture
document decides *what and why*; this document specifies *exactly how*. When
the two disagree, the architecture document wins — flag the conflict instead
of guessing.

> **Implementation note (2026-07-23):** PR-1 simplified two points below
> after building against the existing codebase; neither changes the security
> properties this guide requires.
> - There is no separate `GET /api/network/nonce` endpoint. Enroll/session
>   device-proof headers reuse the exact scheme already shipped for
>   `/api/network/credentials` (`x-peerly-device-key/request-ts/request-nonce/
>   request-signature`); single-use replay protection comes from
>   `UserGatewayDO.consumeNonce` hashing the client-supplied nonce, not a
>   server-minted one. The 60-second timestamp window plus per-hash
>   single-use tracking gives the same guarantee with one fewer round trip.
> - Signed tokens (capability, cookie) are `v1.<body>.<mac>` — no embedded
>   `c`/`p` key-id segment (section 4.1 below is superseded on this point). A
>   token cannot know in advance that its signing secret will later become
>   "previous" during rotation, so verification tries `current` then
>   `previous` unconditionally instead of trusting a tag written at mint time.
> - Section 13 is superseded: `durable_objects`/`migrations` must NOT appear
>   in the default `wrangler.jsonc` until the Phase 5 cutover PR. Workers
>   Builds deploys every non-production branch with `wrangler versions
>   upload`, and Cloudflare rejects any version carrying a DO migration (API
>   error 10211) — so a default config with migrations turns every branch
>   build red and breaks `{branch}-{app}.codefusion.workers.dev` preview
>   aliases. The DO-enabled staging worker lives in `wrangler.preview.jsonc`
>   (a standalone config, since `migrations` is top-level-only and would leak
>   into version uploads from any shared file). The cutover PR moves
>   bindings+migrations into the default config; its own branch build will
>   red on 10211 — expected, resolved by the merge-to-main full deploy.
>   Section 13's two-tag split (`realtime-v1` then `realtime-v2` for the
>   second batch of classes) is also superseded: each app's
>   `wrangler.preview.jsonc` declares every one of its classes in a single
>   `realtime-v1` migration. Since production has not deployed yet, there is
>   no existing tag history to reconcile — the Phase 5 cutover PR carries
>   forward whatever tag layout each app's already-deployed preview
>   established (single combined tag), not section 13's split. Migration tags
>   remain append-only from that point on.
> - Section 1 is superseded: `interestQueue.mjs`, `presenceStats.mjs`, and
>   `roomDirectory.mjs` are implemented in the **HeyHubs repo**
>   (`worker/realtime/`), not in `packages/core`. Each has exactly one
>   consumer (HeyHubs), so keeping them in `@peerly/core` would mean Peerly
>   source carrying HeyHubs-only product code (matching, presence stats, room
>   directory) with no shared-code benefit — see
>   [DURABLE_OBJECTS_AUDIT.md](./DURABLE_OBJECTS_AUDIT.md) finding A1. They
>   import `LIMITS` and `deriveScopeRouteId` from `@peerly/core/worker/realtime`
>   like any other consumer of the package, so route-id derivation stays
>   identical across the two RPC call sites (`UserGatewayDO.handleScopeRequest`
>   in core, `InterestQueueDO.tryMatch` in HeyHubs).

## 0. Rules for the implementing agent

1. Implement one numbered PR from section 15 at a time, in order. Do not mix
   PRs or pull work forward from a later PR.
2. Copy names exactly: file paths, exported symbols, SQL table and column
   names, frame `type` strings, error codes, env var names. Tests and both
   apps depend on these strings matching.
3. Never invent a new frame type, table, endpoint, or limit. If something is
   missing here, stop and ask; do not improvise.
4. All new Worker/DO code is plain-JS `.mjs` in `packages/core/worker/`
   (matching `googleAuth.mjs` / `networkCredentials.mjs`); all new
   browser-side code is TypeScript in `packages/core/src/realtime/`.
5. Reuse the existing helpers instead of rewriting them: base64url helpers and
   OIDC verification from `packages/core/worker/networkCredentials.mjs`,
   device keys from `packages/core/src/deviceIdentity.ts`.
6. Every PR must pass: `npm test`, `npm run test:workers`, `npm run lint`,
   and `npm run worker:check` in each touched repo, plus the PR's own
   "done when" list.
7. Billing rules are correctness rules here: no `setInterval`, no application
   heartbeats, no unbounded queries, no per-message SQL writes, no cross-DO
   fan-out beyond what a section explicitly specifies.

## 1. New files at a glance

`packages/core` (Peerly repo, published to HeyHubs via the normal core
release):

```text
packages/core/src/realtime/
  types.ts        wire types, error codes, event kinds (mirrors section 3)
  protocol.ts     encode/validate frames, size checks (section 3.5)
  limits.ts       client-visible constants re-exported from shared limits
  client.ts       RealtimeClient state machine (section 12)
  transport.ts    CoordinationTransport port + backend selector (section 12.4)

packages/core/worker/realtime/
  index.mjs       re-exports every shared DO class and route handler below
  limits.mjs      single source of truth for every cap (section 2)
  crypto.mjs      hmac helpers, token mint/verify, opaque ids, deriveScopeRouteId (section 4)
  auth.mjs        nonce/enroll/session route handlers (section 5)
  router.mjs      handleRealtimeRoute(request, env, config) (section 5.7)
  userGateway.mjs UserGatewayDO (section 6)
  signalScope.mjs SignalScopeDO (section 7)
  workspace.mjs   WorkspaceDO — Peerly only (section 8)
```

`InterestQueueDO`, `PresenceStatsShardDO`, and `RoomDirectoryShardDO`
(sections 9–11) are HeyHubs-only and live in the **HeyHubs repo** at
`worker/realtime/` — see the superseded note above. They import `LIMITS` and
`deriveScopeRouteId` from `@peerly/core/worker/realtime` like any other
consumer of the package.

Add to `packages/core/package.json` `exports`:

```jsonc
"./worker/realtime": { "default": "./worker/realtime/index.mjs" }
```

Peerly's `worker/index.mjs` re-exports `UserGatewayDO`, `SignalScopeDO`, and
`WorkspaceDO` from core (Wrangler requires DO classes to be exported from
`main`). HeyHubs' `worker/index.mjs` re-exports `UserGatewayDO`/`SignalScopeDO`
from core and its own local `InterestQueueDO`/`PresenceStatsShardDO`/
`RoomDirectoryShardDO` from `./realtime/*.mjs`:

```js
// Peerly worker/index.mjs
export { UserGatewayDO, SignalScopeDO, WorkspaceDO } from '@peerly/core/worker/realtime'

// HeyHubs worker/index.mjs
export { UserGatewayDO, SignalScopeDO } from '@peerly/core/worker/realtime'
export { InterestQueueDO, PresenceStatsShardDO, RoomDirectoryShardDO } from './realtime/...'
```

(Peerly's own worker imports core by relative path, mirroring its existing
imports: `../packages/core/worker/realtime/index.mjs`.)

## 2. Shared limits — `worker/realtime/limits.mjs`

One frozen object; every server check imports from here, and
`src/realtime/limits.ts` re-exports the client-relevant subset. Values come
from the architecture document's caps table:

```js
export const LIMITS = Object.freeze({
  protocolVersion: 1,
  controlFrameBytes: 32 * 1024,
  signalFrameBytes: 16 * 1024,
  controlSocketsPerAccount: 3,
  signalSocketsPerDevice: 8,
  participantsPerScope: 16,
  commandsBurst: 20,          // per control socket, per second
  commandsSustained: 5,       // per second over a 10 s window
  signalsBurst: 50,
  signalsSustained: 20,
  interestsPerSeek: 5,
  seekLeaseMs: 30 * 60_000,
  reservationMs: 30_000,
  directoryPageEntries: 50,
  directoryPayloadBytes: 8 * 1024,
  mailboxEntries: 100,
  idempotencyTtlMs: 24 * 60 * 60_000,
  eventRetention: 1000,       // rows kept for resume, per gateway
  eventRetentionMs: 24 * 60 * 60_000,
  nonceTtlMs: 2 * 60_000,
  cookieTtlMs: 10 * 60_000,
  capabilityTtlMs: 30 * 24 * 60 * 60_000,
  scopeAuthorizationTtlMs: 10 * 60_000,
  presenceLeaseMs: 60 * 60_000,
  statsCacheSeconds: 30,
  attachmentBytes: 2048,      // platform limit on serializeAttachment
  batchWindowMs: 75,
  batchMaxEvents: 20,
  batchMaxBytes: 16 * 1024,
  shardCount: 1,              // stats + directory; raise only per architecture doc
})
```

## 3. Wire protocol

### 3.1 Envelope

Every control and signaling frame is a single JSON text message:

```ts
type RealtimeFrame = {
  v: 1
  id: string          // 1–64 chars [A-Za-z0-9_-]; idempotency key on commands
  type: string        // one of the closed unions below
  scope?: string      // opaque scope route id where applicable, ≤ 128 chars
  seq?: number        // server-assigned stream sequence (server frames only)
  sentAt: number      // sender epoch ms
  payload?: unknown   // per-type shape below
}
```

### 3.2 Client → server control commands

| `type` | `payload` | notes |
| --- | --- | --- |
| `hello` | `{ version: 1, resumeSeq?: number }` | must be the first frame; anything else first → close `4002` |
| `scope.request` | `{ kind: 'workspace'\|'dm'\|'room'\|'chat', capability: string }` | capability ≤ 256 chars; reply `ack` payload `{ routeId, expiresAt }` |
| `scope.leave` | `{ routeId: string }` | never batched |
| `seek.start` | `{ seekId, interests: string[], exclusions: string[] }` | HeyHubs; ≤ `interestsPerSeek` normalized interests |
| `seek.cancel` | `{ seekId }` | idempotent |
| `invite.send` | `{ to: string, kind: string, body: object }` | `to` is an opaque user id; body ≤ 4 KiB |
| `invite.ack` | `{ inviteId }` | |
| `ring.send` | `{ to: string, roomRoute: string }` | DM ring |
| `directory.publish` | `{ roomId, revision, entry: object }` | entry ≤ `directoryPayloadBytes`, signed by device key |
| `directory.delete` | `{ roomId, revision }` | |
| `directory.list` | `{ cursor?: string }` | reply is a `snapshot` frame, ≤ `directoryPageEntries` |
| `resume` | `{ fromSeq: number }` | reply: ordered `delta`s, or `snapshot` if the cursor aged out |

`ping` is never a JSON command: the client sends the literal text `ping` and
the DO answers `pong` via WebSocket auto-response without waking (section 6.2).

### 3.3 Server → client frames

| `type` | `payload` |
| --- | --- |
| `ack` | `{ for: string, result?: object }` — `for` echoes the command `id` |
| `error` | `{ for?: string, code: ErrorCode, retryable: boolean, retryAfterMs?: number }` |
| `snapshot` | `{ kind: string, state: object, seq: number }` |
| `delta` | `{ events: Event[], seq: number }` — `seq` of the last event |
| `bye` | `{ code: CloseCode }` — sent just before server close |

### 3.4 Delta event kinds (closed union)

`invite`, `invite.acked`, `ring`, `seek.state`, `match.commit`
(`{ matchId, routeId, peer: { opaqueUserId } }`), `directory.change`,
`workspace.presence`, `device.revoked`, `sync.notice`.

### 3.5 Server parsing algorithm — exact order

1. If the message is not a string, close `4003`.
2. If `message.length > limitBytes` (chars are a lower bound for bytes),
   close `4013`.
3. `bytes = new TextEncoder().encode(message)`; if
   `bytes.byteLength > limitBytes`, close `4013`.
4. `JSON.parse`; on throw, close `4003`.
5. Validate envelope: `v === 1`, `id` matches `/^[\w-]{1,64}$/`, `type` in the
   closed union, `sentAt` is a finite number. Unknown top-level or payload
   fields are **discarded**, not errors.
6. Validate the per-type payload shape and every string/array cap. Failure →
   `error { code: 'invalid-frame', retryable: false }` (do not close).
7. Rate-limit check (section 6.3). Over limit → `error 'rate-limited'` with
   `retryAfterMs`; repeated abuse → close `4008`.
8. Idempotency check for mutating commands: if `id` is in the `idempotency`
   table, re-send the stored `ack` and stop.

### 3.6 Error and close codes

```ts
type ErrorCode =
  | 'invalid-frame' | 'auth-required' | 'version-unsupported'
  | 'rate-limited'  | 'too-large'     | 'cap-exceeded'
  | 'not-found'     | 'conflict'      | 'service-unavailable' | 'internal'
```

WebSocket close codes: `4001` auth-required/revoked, `4002`
version-unsupported (client must upgrade), `4003` malformed frame, `4008`
rate-limit abuse, `4009` slow consumer, `4013` frame too large, `1012`
service restart (client may reconnect immediately).

HTTP: `401` failed auth, `403` bad origin, `409` replay/conflict, `413` too
large, `429` + `Retry-After` rate/quota, `503` + `Retry-After` quota
fail-closed.

## 4. Crypto recipes — `worker/realtime/crypto.mjs`

Reuse `base64UrlBytes` / `bytesBase64Url` patterns from
`networkCredentials.mjs` (import or lift into `crypto.mjs` and re-export).
All HMACs are HMAC-SHA-256 via WebCrypto. All random values come from
`crypto.getRandomValues` (32 bytes, base64url) or `crypto.randomUUID()`.

### 4.1 Token format (capability and cookie share it)

```text
v1.<keyId>.<payloadB64url>.<macB64url>
```

- `payload` = UTF-8 JSON, `mac` = HMAC(secret[keyId], `${prefix}\n` + payloadB64url).
- `keyId` is `c` (current) or `p` (previous). Verification tries `c` then `p`.
- Secrets: `NETWORK_SESSION_SECRET` may hold one value or
  `current:previous` separated by a colon; split on first `:`.

Device-session capability (`prefix = 'realtime-capability-v1'`), payload:

```json
{ "app": "peerly", "uid": "<opaque>", "dk": "P-256:<x>:<y>",
  "sid": "<uuid>", "epoch": 1, "iat": 0, "exp": 0, "ver": 1 }
```

Network cookie (`prefix = 'realtime-cookie-v1'`), name `pnet`, same payload
minus `epoch`, `exp = iat + cookieTtlMs`, attributes exactly:
`Path=/api/realtime; Secure; HttpOnly; SameSite=Strict; Max-Age=600`.

### 4.2 Opaque user id

```text
uid = bytesBase64Url(HMAC(OPAQUE_USER_ID_SECRET,
        'opaque-user-v1\n' + app + '\n' + issuer + '\n' + subject))
```

`app` is `'peerly'` or `'heyhubs'`. Never log issuer or subject; never store
them in any DO.

### 4.3 Server nonce

`GET /api/network/nonce` returns `{ nonce, expiresAt }` where
`nonce = v1.c.<b64url({ r: <32B random>, exp })>.<mac>` with
`prefix = 'realtime-nonce-v1'`. Stateless to mint; single-use is enforced by
`UserGatewayDO.consumeNonce(hashHex, expiresAt)` which inserts
`SHA-256(nonce)` into the `nonces` table and returns `false` on conflict.

### 4.4 Device signature schemes

Exactly the `networkCredentials.mjs` pattern — newline-joined fields signed
with the P-256 device key (`SIGN_ALGORITHM = { name:'ECDSA', hash:'SHA-256' }`):

```text
enroll  : 'realtime-enroll-v1'  \n app \n deviceKeyId \n nonce \n oidcTokenSha256B64url
session : 'realtime-session-v1' \n app \n deviceKeyId \n sid \n nonce
```

Verify with the public key reconstructed from `deviceKeyId`
(`P-256:<x>:<y>`, both base64url), as `oidcDeviceBinding.ts` already does.

## 5. HTTP endpoints

All endpoints: reject non-allowlisted `Origin` with `403` (each app passes its
existing origin predicate — `allowedAuthParent` — into the router config);
reject bodies over 16 KB with `413` before JSON parsing; respond
`content-type: application/json`.

### 5.1 `GET /api/network/nonce`

No auth. Response `200 { nonce, expiresAt }`. Rate-limit by the existing
Wrangler `ratelimits` binding when present.

### 5.2 `POST /api/network/enroll`

Request:

```json
{ "provider": "google", "token": "<OIDC id token>", "deviceKeyId": "P-256:..",
  "nonce": "<server nonce>", "signature": "<b64url ECDSA>" }
```

Steps (all failures `401` except noted): verify nonce token not expired →
verify OIDC token via the existing `resolveOidcProvider` + `verifyOidcToken`
→ derive `uid` (4.2) → verify device signature (4.4 enroll) → RPC
`env.USER_GATEWAYS.getByName(app + ':' + uid).consumeNonce(...)`, replay →
`409` → RPC `registerSession({ sid, deviceKeyId, now })` (gateway enforces
the 3-device cap; over cap → `409 { code: 'cap-exceeded' }`) → mint
capability (4.1). Response `200 { capability, expiresAt }`. Never set a
cookie here. Client stores the capability in IndexedDB and discards the OIDC
token.

### 5.3 `POST /api/network/session`

Request: `{ "capability": "...", "nonce": "...", "signature": "..." }`
(signature scheme `session`). Steps: verify capability MAC + expiry + `app` →
verify device signature → gateway RPC `consumeNonce` →
`validateSession({ sid, deviceKeyId, epoch })` (rejects revoked epochs) →
set cookie (4.1) → respond
`200 { runtimeConfig, turn: { urls, username, credential, expiresAt } }`,
reusing the TURN REST minting already in `networkCredentials.mjs`. Never
return `TURN_AUTH_SECRET` itself.

### 5.4 `GET /api/realtime/control` (WebSocket upgrade)

Validate `Upgrade: websocket` header (else `426`), `Origin`, cookie (parse
from `Cookie` header, verify MAC/expiry/app). Then
`return env.USER_GATEWAYS.getByName(app + ':' + uid).fetch(request)` after
appending trusted context headers the DO reads:
`x-realtime-uid`, `x-realtime-dk`, `x-realtime-sid` (the DO never trusts
these from outside — the Worker strips any incoming `x-realtime-*` headers
first).

### 5.5 `GET /api/realtime/signal/{routeId}` (WebSocket upgrade)

Same validation as 5.4, then
`env.SIGNAL_SCOPES.getByName(app + ':' + routeId).fetch(request)` with the
same trusted headers. The scope DO independently requires a live
authorization row for `(uid, dk)` (section 7) — the routeId alone grants
nothing.

### 5.6 `GET /api/stats/snapshot` — HeyHubs only

No cookie required. Worker checks `caches.default` for
`https://internal/stats-snapshot`; on miss, RPC
`PRESENCE_STATS.getByName('heyhubs:0').snapshot()` and cache with
`Cache-Control: max-age=30`. Response
`{ online: number, interests: [{ tag, count }] }` (top 50 tags max). Clients
call this only while a discovery surface is visible, ≥ 30 s apart.

### 5.7 Router wiring

`router.mjs` exports one function used by both app workers:

```js
export async function handleRealtimeRoute(request, env, config) // → Response | null
```

`config = { app, allowedOrigin(origin), backendVar }`. It returns `null` for
paths it does not own so each app's existing `worker/index.mjs` chain
(`googleAuth`, `networkCredentials`, assets) stays untouched; insert the call
before the auth-bridge fallthrough. When
`env.COORDINATION_BACKEND !== 'durable-objects'`, every `/api/realtime/*` and
`/api/network/nonce|enroll|session` request returns
`503 { code: 'service-unavailable' }` — the legacy adapter never talks to
these routes.

## 6. `UserGatewayDO` — `worker/realtime/userGateway.mjs`

Class extends `DurableObject` from `cloudflare:workers`.

### 6.1 SQL schema (constructor, synchronous, before anything else)

```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY, dk TEXT NOT NULL, epoch INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS device_epochs (dk TEXT PRIMARY KEY, epoch INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS nonces_exp ON nonces(expires_at);
CREATE TABLE IF NOT EXISTS idempotency (
  cmd_id TEXT PRIMARY KEY, ack TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idem_exp ON idempotency(expires_at);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mailbox (
  invite_id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS seek (
  one INTEGER PRIMARY KEY CHECK (one = 1), seek_id TEXT, state TEXT,
  reservation_id TEXT, queue_key TEXT, interests TEXT, expires_at INTEGER);
```

`meta` holds `stream_seq` (last assigned sequence). Do not keep a JS mirror
of any of this as the source of truth.

### 6.2 Socket accept

In the constructor:

```js
this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
```

In `fetch(request)` (upgrades only — everything else is RPC):

1. Read `x-realtime-uid/dk/sid` headers; look up the session row; reject if
   missing/expired/epoch-revoked with `401`.
2. If `this.ctx.getWebSockets().length >= LIMITS.controlSocketsPerAccount`,
   close the oldest (`4009`) before accepting the new one.
3. `const [client, server] = Object.values(new WebSocketPair())`
4. `this.ctx.acceptWebSocket(server)` — **never** `server.accept()`.
5. `server.serializeAttachment({ cid: crypto.randomUUID(), dk, sid, v: 0, ackSeq: 0 })`
   — keep under `attachmentBytes`; anything larger lives in SQL keyed by `cid`.
6. `return new Response(null, { status: 101, webSocket: client })`

After hibernation, sockets come back via `this.ctx.getWebSockets()` and
`ws.deserializeAttachment()`; there is no in-memory connection map to rebuild.

### 6.3 `webSocketMessage(ws, message)`

Apply section 3.5 with `controlFrameBytes`. Rate limiting: a token bucket
per socket kept in a plain `Map` keyed by `cid` (in-memory is acceptable —
hibernation resets it, which only ever refills tokens). The first frame must
be `hello`; store the negotiated version in the attachment
(`ws.serializeAttachment({...old, v: 1 })`).

Command dispatch (each mutating command: persist → write `idempotency` row →
send `ack`, in that order, with no `await` between the SQL statements):

- `seek.start` → normalize interests (lowercase, NFKC, trim, ≤ 32 chars,
  dedupe, cap 5); write `seek` row (`state='seeking'`,
  `expires_at = now + seekLeaseMs`); RPC
  `InterestQueueDO.enqueue(...)` per interest (HeyHubs config only);
  schedule alarm (6.5).
- `seek.cancel` → clear `seek` row; RPC `dequeue` to each queue in
  `interests`; failures are ignored (queue rows expire on their own).
- `scope.request` → validate capability shape; derive
  `routeId = bytesBase64Url(HMAC(OPAQUE_USER_ID_SECRET, 'scope-route-v1\n' + app + '\n' + kind + '\n' + capability))`;
  RPC `SignalScopeDO.authorize({ uid, dk, expiresAt })`; ack
  `{ routeId, expiresAt }`.
- `invite.send` / `ring.send` → RPC target gateway
  `deliver({ events: [...] })`; also insert into the *target's* mailbox via
  the same RPC when it has no open sockets.
- `directory.*` → RPC the directory shard
  (`hash(roomId) % LIMITS.shardCount`), relay result as `ack`/`snapshot`.
- `resume` → section 6.6.

### 6.4 RPC methods (called by Worker routes and other DOs)

```js
async consumeNonce(hashHex, expiresAt)            // → boolean
async registerSession({ sid, dk, now })           // → { ok } | { code:'cap-exceeded' }
async validateSession({ sid, dk, epoch })         // → { ok: boolean }
async revokeDevice(dk)                            // bump device_epochs, close its sockets 4001
async deliver({ events, mailbox })                // append events, push, cap mailbox at 100 (drop oldest)
async reserveForMatch({ reservationId, queueKey, seekId, expiresAt }) // → { ok } | { busy }
async commitMatch({ reservationId, matchId, routeId, peerUid })       // idempotent by reservationId
async releaseMatch({ reservationId })             // idempotent
```

`reserveForMatch` succeeds only if the `seek` row exists, is `seeking`, and
`seek_id` matches; it sets `state='reserved'`, `reservation_id`, and
`expires_at = now + reservationMs`. `commitMatch` requires the matching
`reservation_id`, sets `state='matched'`, appends a `match.commit` event, and
clears the row.

### 6.5 `alarm()`

Single alarm, always rescheduled to the earliest pending expiry among:
`sessions`, `nonces`, `idempotency`, `events` retention, `seek.expires_at`.
The handler deletes expired rows (bounded `DELETE ... WHERE expires_at <= ?`),
releases an expired reservation (`state='reserved'` → back to `seeking'` if
lease remains, else cleared + `seek.state` event), then re-queries the next
earliest expiry and `setAlarm`s it. The handler must be safe to run twice.

### 6.6 Event stream and resume

`appendEvents(kind, body)[]`: read `stream_seq` from `meta`, assign
consecutive seqs, insert rows and update `meta` in the same synchronous
block, then push one batched `delta` frame to every open socket (batch
per `batchWindowMs` via a single pending `Promise`-based flush — never
`setInterval`). On `resume { fromSeq }`: if `fromSeq` ≥ oldest retained seq,
send the missing `delta`s in order; otherwise send `snapshot` frames
(current seek state, mailbox, workspace presence subscription state) with the
current seq. Prune `events` beyond `eventRetention` rows or
`eventRetentionMs` age in the alarm.

## 7. `SignalScopeDO` — `worker/realtime/signalScope.mjs`

Schema:

```sql
CREATE TABLE IF NOT EXISTS authorizations (
  uid TEXT NOT NULL, dk TEXT NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY (uid, dk));
CREATE INDEX IF NOT EXISTS auth_exp ON authorizations(expires_at);
```

RPC `authorize({ uid, dk, expiresAt })` upserts a row (cap: refuse when the
table exceeds `participantsPerScope * 2` live rows → `{ code:'cap-exceeded' }`).

`fetch` (upgrade): require a live authorization row for the header
`uid`/`dk` (else `403`); enforce `participantsPerScope` across
`getWebSockets()`; accept with attachment `{ cid, uid, dk }`; announce
`{ type:'peer.join' }` to others; on `webSocketClose`, announce `peer.leave`.

`webSocketMessage`: section 3.5 with `signalFrameBytes`; the only accepted
type is `signal` with `payload` forwarded **opaquely** — the DO never parses
SDP/ICE. Frames carry `to` (a `cid`) or broadcast to all other sockets.
Attach `from: cid` on delivery. Rate limit per socket
(`signalsBurst`/`signalsSustained`). No SQL writes on the message path.
Alarm: delete expired authorization rows; when the table is empty and no
sockets remain, `this.ctx.storage.deleteAll()` so the object costs nothing.

The client-side adapter in `transport.ts` presents the same interface
Trystero's strategy layer expects (join/leave/onPeer/signal per scope) so app
code above the port does not change.

## 8. `WorkspaceDO` — Peerly only, `worker/realtime/workspace.mjs`

Schema: `members(uid PK, dk, capability_version INTEGER, joined_at,
expires_at)`, `presence(uid PK, state TEXT, updated_at)`. RPCs:
`join({ uid, dk, capabilityVersion })`, `leave({ uid })`,
`presenceUpdate({ uid, state })` (coalesced by callers),
`revokeMember({ uid, notifyGateways: true })`. On membership/presence change,
RPC `deliver` to each member's gateway with a `workspace.presence` event —
fan-out is bounded by workspace size, which Peerly already caps. Signed
member/device capability verification stays client-side exactly as today;
this object only coordinates.

## 9. `InterestQueueDO` — HeyHubs only, `worker/realtime/interestQueue.mjs`

Schema:

```sql
CREATE TABLE IF NOT EXISTS seeks (
  uid TEXT PRIMARY KEY, seek_id TEXT NOT NULL, dk TEXT NOT NULL,
  exclusions TEXT NOT NULL DEFAULT '[]',
  enqueued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS seeks_exp ON seeks(expires_at);
CREATE TABLE IF NOT EXISTS cooldowns (
  pair TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
```

`pair` = the two uids sorted lexically, joined with `\n`. RPCs:
`enqueue({ uid, seekId, dk, exclusions, expiresAt })`, `dequeue({ uid, seekId })`.

Matching runs after every `enqueue` and in the alarm — never on a timer:

1. Load the up-to-20 oldest unexpired seeks. Find the first pair (A, B),
   A ≠ B, where neither excludes the other and `cooldowns` has no live
   `pair` row. No pair → stop.
2. `reservationId = crypto.randomUUID()`; order the two uids lexically —
   always reserve the smaller uid first (deadlock prevention).
3. RPC `gatewayA.reserveForMatch(...)`. `{ busy }` → delete A's row here
   (its gateway state is authoritative; a stale row must not block others)
   and go to 1.
4. RPC `gatewayB.reserveForMatch(...)`. `{ busy }` → **compensate**: RPC
   `gatewayA.releaseMatch({ reservationId })` (on RPC failure, do nothing —
   A's reservation expires via its own alarm in `reservationMs`), delete
   B's row, go to 1.
5. Both ok → `matchId = crypto.randomUUID()`;
   `capability = bytesBase64Url(crypto.getRandomValues(new Uint8Array(32)))`;
   derive `routeId` (same recipe as `scope.request`, kind `chat`); RPC
   `SignalScopeDO.authorize` for both `(uid, dk)` pairs; RPC `commitMatch`
   on both gateways (each delivers `match.commit` to its user). A commit RPC
   failure is retried once; a still-failing commit is abandoned — the
   gateway reservation expiry returns that user to `seeking` and the other
   side's client handles a peer that never arrives (already required for
   disconnects).
6. Delete both `seeks` rows and insert the `cooldowns` pair
   (`expires_at = now + 10 * 60_000`) in one synchronous block. RPC
   `PresenceStatsShardDO.publishCount(interest, liveCount)` with the new
   absolute count. Go to 1.

Alarm: drop expired seeks/cooldowns, republish the absolute count, re-run
matching once, reschedule to the earliest remaining expiry.

## 10. `PresenceStatsShardDO` — HeyHubs only, `worker/realtime/presenceStats.mjs`

Schema: `presence(uid PK, expires_at)`, `counters(tag PK, count, updated_at)`.
RPCs: `presenceUpsert({ uid, expiresAt })` (gateway calls on connect, on
clean close with `expiresAt = now`, and at lease half-life **only while a
socket is open** — driven by the gateway's alarm, not a timer),
`publishCount({ tag, count })` (absolute, idempotent), `snapshot()` → count
live presence rows + top-50 counters. Alarm: prune expired rows hourly-ish
(earliest expiry). Never called on the matching path.

## 11. `RoomDirectoryShardDO` — HeyHubs only, `worker/realtime/roomDirectory.mjs`

Schema:

```sql
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, dk TEXT NOT NULL,
  revision INTEGER NOT NULL, entry TEXT NOT NULL,
  updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rooms_exp ON rooms(expires_at);
```

RPCs: `publish({ roomId, ownerUid, dk, revision, entry, expiresAt })` —
reject if an existing row has a different `owner_uid` (`conflict`), a
`revision` ≤ stored (`conflict`), oversized entry (`too-large`), or the shard
already holds 1,000 rooms (`cap-exceeded`). `remove({ roomId, ownerUid,
revision })`. `list({ cursor, limit })` — keyset pagination ordered by
`(updated_at DESC, room_id)`, `limit ≤ directoryPageEntries`, cursor is the
base64url of the last `(updated_at, room_id)`. Alarm prunes expired rows.

## 12. Client library — `packages/core/src/realtime/`

### 12.1 State machine (`client.ts`)

States: `offline → enrolling → session → connecting → ready`, plus
`backoff`. Full-jitter exponential backoff: `delay = random(0, min(30_000,
250 * 2**attempt))`. `navigator.onLine`/`visibilitychange` may trigger one
immediate attempt but never reset `attempt` more than once per 60 s. A `4002`
close moves to a terminal `upgrade-required` state; `4001` returns to
`enrolling`.

### 12.2 Storage keys

IndexedDB via the existing `kvStore.ts`: database `peerly-realtime`, store
`state`, keys `capability` (the token string), `lastAckSeq` (number). The
OIDC token is never written anywhere.

### 12.3 Send pipeline

Bounded queue (100 commands, reject beyond); superseded presence/stat
commands are replaced in place by `type + scope` key. Every command gets
`id = crypto.randomUUID()` once and keeps it across retries. Commands are
resent after reconnect+resume only if no `ack`/`error` arrived. `hello` is
sent first on every (re)connect with `resumeSeq = lastAckSeq`.

### 12.4 Transport port (`transport.ts`)

```ts
export interface CoordinationTransport {
  connect(): Promise<void>
  close(): void
  requestScope(kind: ScopeKind, capability: string): Promise<ScopeHandle>
  startSeek(opts: SeekOptions): Promise<void>
  cancelSeek(seekId: string): Promise<void>
  publishRoom(entry: RoomEntry): Promise<void>
  deleteRoom(roomId: string, revision: number): Promise<void>
  listRooms(cursor?: string): Promise<RoomPage>
  sendInvite(to: string, kind: string, body: object): Promise<void>
  events: EventTarget            // typed delta events from section 3.4
  readonly diagnostics: TransportDiagnostics
}
```

`selectTransport(config)` returns the DO implementation when
`COORDINATION_BACKEND === 'durable-objects'`, else the legacy relay adapter
(which wraps today's relay client unchanged). Nothing above this port may
import either implementation directly.

## 13. Wrangler configuration

Peerly `wrangler.jsonc` — add at top level **and repeat the
`durable_objects` block inside `env.preview`** (bindings are
non-inheritable; `migrations` is top-level only):

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "USER_GATEWAYS", "class_name": "UserGatewayDO" },
    { "name": "SIGNAL_SCOPES", "class_name": "SignalScopeDO" },
    { "name": "WORKSPACES",    "class_name": "WorkspaceDO" }
  ]
},
"migrations": [
  { "tag": "realtime-v1", "new_sqlite_classes": ["UserGatewayDO", "SignalScopeDO"] },
  { "tag": "realtime-v2", "new_sqlite_classes": ["WorkspaceDO"] }
],
"vars": { /* existing…, */ "COORDINATION_BACKEND": "legacy-relay" }
```

HeyHubs `wrangler.jsonc`: same pattern with `INTEREST_QUEUES`,
`PRESENCE_STATS`, `ROOM_DIRECTORY` in `realtime-v2`, and its `secrets.required`
extended with `NETWORK_SESSION_SECRET`, `OPAQUE_USER_ID_SECRET`. Migration
tags are append-only forever; add `realtime-v3`, never edit `realtime-v1`.
`COORDINATION_BACKEND` flips to `durable-objects` only in the Phase 5 PR.
Set secrets with `wrangler secret put <NAME>` (and `--env preview`).

## 14. Testing

Add `@cloudflare/vitest-pool-workers` to devDependencies in both repos and a
separate config so existing unit tests are untouched:

```ts
// vitest.workers.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
export default defineWorkersConfig({
  test: {
    include: ['worker/**/*.workers.test.mjs'],
    poolOptions: { workers: { wrangler: { configPath: './wrangler.jsonc' } } },
  },
})
```

Script: `"test:workers": "vitest run -c vitest.workers.config.ts"`.

Required test files and the cases each must cover:

- `worker/realtime/protocol.workers.test.mjs` — every 3.5 step at its
  boundary (32 KiB ± 1 byte, bad JSON, unknown type, unknown-field discard,
  first-frame-not-hello close 4002).
- `worker/realtime/auth.workers.test.mjs` — nonce replay 409, expired nonce,
  bad origin 403, bad signature 401, device cap 409, cookie
  attributes/expiry, rotated `current:previous` secret still verifies,
  opaque id never contains the provider subject.
- `worker/realtime/userGateway.workers.test.mjs` — connect, `hello`,
  idempotent command replay returns the stored ack, resume after
  `runInDurableObject` restart with only attachments+SQL, `4009` on a 4th
  socket, `revokeDevice` closes with 4001, alarm prune via
  `runDurableObjectAlarm`, mailbox cap drop-oldest.
- `worker/realtime/signalScope.workers.test.mjs` — no authorization row →
  403, opaque forwarding with `from`, participant cap, `deleteAll` after
  empty alarm, cross-scope isolation (two scopes, no leakage).
- `worker/realtime/interestQueue.workers.test.mjs` — happy match, `busy` on
  first reserve, compensation on second reserve, commit retry, reservation
  expiry re-queues, cooldown blocks rematch, exclusions, expired seeks
  pruned, duplicate `enqueue` idempotent.
- `worker/realtime/roomDirectory.workers.test.mjs` — owner mismatch,
  stale revision, pagination cursor stability, expiry.
- Browser E2E additions per the architecture document's list (Playwright,
  both repos).

## 15. PR sequence

**PR-1 — protocol, auth, gateway (Phase 1).** Files: sections 2, 3, 4, 5
(`auth.mjs`, `router.mjs`), 6, 12 (`types.ts`, `protocol.ts`, `client.ts`
connect/hello/resume only), 13 (with `COORDINATION_BACKEND=legacy-relay`),
14 (protocol/auth/gateway tests). Done when: both apps deploy to preview,
a browser holds a control socket, survives a forced restart with resume, and
`npm run test:workers` passes in both repos.

**PR-2 — signaling + TURN (Phase 2).** Files: section 7, `transport.ts`
scope handling, session-endpoint TURN reuse. Done when: two preview browsers
complete WebRTC via DO signaling on Chromium/Firefox/WebKit, forced-TURN
matrix passes, a live session survives control-socket loss.

**PR-3 — Peerly coordination (Phase 3).** Files: section 8 + Peerly client
wiring. Done when: Peerly preview passes workspace presence/reconnect/
revocation E2E and the legacy coordinator is off the default path.

**PR-4 — HeyHubs matching + discovery (Phase 4).** Files: sections 9, 10,
11 + HeyHubs client wiring + stats endpoint 5.6. Done when: the
interest-queue test file passes, two-browser overlapping-interest E2E
matches exactly once, directory and stats survive a forced restart.

**PR-5 — cutover (Phase 5).** Flip `COORDINATION_BACKEND` in both repos,
add the synthetic probe. Done when: the architecture document's seven-day
exit criteria are being measured on its dashboards.

**PR-6 — VPS relay shutdown (Phase 6).** Per the architecture document,
including the Cloudflare Realtime TURN evaluation.

## 16. Pitfalls that will fail review

- `server.accept()` instead of `ctx.acceptWebSocket(server)` — silently
  disables hibernation and burns the duration budget.
- Any `setInterval`/`setTimeout` keep-alive, or JSON `ping` frames reaching
  `webSocketMessage` instead of the auto-response pair.
- `await` between related SQL statements (splits the atomic block), or
  acknowledging before persisting.
- Trusting an in-memory map across hibernation; trusting `x-realtime-*`
  headers that the Worker did not set; forgetting to strip inbound
  `x-realtime-*` headers.
- Attachments over 2,048 bytes (throws at runtime).
- `SELECT` without an indexed predicate on any table with an expiry column.
- Adding bindings only at top level and not in `env.preview`, or renaming a
  shipped migration tag.
- Logging emails, provider subjects, capabilities, cookies, SDP, or ICE.
- Returning the raw scope capability to any socket, or accepting a signal
  upgrade on routeId alone without the authorization-row check.
- Calling `PresenceStatsShardDO` or any stats path from matching code.
