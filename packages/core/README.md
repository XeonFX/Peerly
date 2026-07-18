# @peerly/core

The P2P room core of [Peerly](https://github.com/XeonFX/Peerly) — join encrypted
[Trystero](https://github.com/dmotz/trystero) rooms by high-entropy room codes,
with device identity, signing primitives, and signaling-strategy selection.
No application server: signaling (Nostr by default) is used only so browsers can
find each other; everything after the handshake is direct WebRTC.

Powers Peerly and any app that joins the same style of encrypted Trystero
rooms. MIT.

## Install

```bash
npm install @peerly/core
```

`@trystero-p2p/supabase`, `@trystero-p2p/ws-relay`, and `react` are optional
peer dependencies — install the ones your app actually uses. All signaling
strategies are imported dynamically, so your bundle only carries the transport
you select.

## The model

A **room code** is a 128-bit random hex string that doubles as the room's
Trystero password: whoever holds the code can address the room *and* decrypt
its WebRTC handshake, and nobody else can. Sharing the code is granting access;
there is nothing to configure server-side because there is no server.

```ts
import { generateRoomCode, joinRoomByCode, resolveSignalingStrategy } from '@peerly/core'

const code = generateRoomCode() // e.g. "9f8f3a…" — share it out-of-band

const room = await joinRoomByCode({
  strategy: resolveSignalingStrategy(import.meta.env),
  appId: 'my-app-v1',
  roomId: code,
  password: code,
  env: import.meta.env,
})

// Trystero action API (object form — not the older tuple form)
const hello = room.makeAction<string>('hello')
hello.onMessage = (msg, { peerId }) => console.log(peerId, msg)
room.onPeerJoin = peerId => void hello.send('hi', { target: peerId })
```

Functions never read `import.meta.env` themselves — Vite substitutes that
per-bundle, so a library cannot see the app's values. Pass your env (or any
plain object) where a function takes `env`.

`selfId` is re-exported from `@trystero-p2p/core` so apps can use one peer-id
source without depending on Trystero directly.

## React

```tsx
import { useRoom, useLatest } from '@peerly/core/react'

function Chat({ code }: { code: string }) {
  const { room } = useRoom({
    appId: 'my-app-v1',
    roomId: code,
    password: code,
    env: import.meta.env,
    onError: message => toast(message),
  })
  // room is null until joined; stable across re-renders; leaves on unmount.
  // An empty roomId means "no room yet" and joins nothing — safe for callers
  // whose room is still being negotiated (hooks must run unconditionally).
  // Optional: onPeerHandshake, errorText overrides per RoomErrorKind.
}

// useLatest(value) — ref always pointing at the latest value (stale-closure helper)
```

The hook carries Peerly's hard-won teardown handling: `leave()` is async and
Nostr batches relay subscriptions across rooms, so a leave landing after the
next join silently kills that room's signaling. The hook serializes them —
StrictMode remounts and room switches just work. It also auto-rejoins when ICE
fails after SDP exchange (strict NAT / flaky path).

## Signaling strategies

| Strategy | When | Config |
|----------|------|--------|
| `nostr` (default) | No server, public relays | none — curated `DEFAULT_NOSTR_RELAYS`, override `VITE_NOSTR_RELAYS` |
| `ws-relay` | Offline / CI / local relay | `VITE_SIGNALING=ws-relay`, `resolveRelayUrls(env)` |
| `supabase` | A relay you control | `VITE_SIGNALING=supabase` + `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` |

Related helpers: `signalingLabel()`, `buildRelayUrls()`, `getNostrRelayConfig()`,
`getSupabaseRoomConfig()`, `resolveRelayPort()`.

TURN for strict NATs: `VITE_TURN_URLS`, `VITE_TURN_USERNAME`,
`VITE_TURN_CREDENTIAL` (see `getTurnConfig`).

### Relay diagnostics

```ts
import { probeNostrRelay, probeNostrRelays, createRelayHealth } from '@peerly/core'

// End-to-end: subscribe + publish + require echo (open socket ≠ healthy)
const results = await probeNostrRelays(DEFAULT_NOSTR_RELAYS)

// Live WebSocket visibility while a room is connected
const health = createRelayHealth()
```

Call probes on demand (diagnostics UI / re-check), not on a tight interval —
public relays throttle that.

## Identity primitives

```ts
import { DeviceIdentity, verifyWithDeviceKeyId, deriveUserId } from '@peerly/core'

const device = new DeviceIdentity()          // non-extractable P-256 key, persisted in IndexedDB
const keyId = await device.publicKeyId()     // "P-256:<x>:<y>" — carries the full public key
const signature = await device.sign(bytes)
await verifyWithDeviceKeyId(keyId, bytes, signature) // no key distribution needed

const userId = await deriveUserId(jwt.iss, jwt.sub)  // durable, provider-namespaced, unlinkable
```

The private key is generated non-extractable and never leaves WebCrypto — an
XSS can sign while it runs, but cannot copy the key out.

Also: `canonicalizePublicKey`.

## Shared chat, merge, media, attention

Reusable primitives for apps built on this core. App-specific wire schemes stay
in the app; encoding and crypto are shared.

```ts
import {
  // Canonical signing bytes (newline-joined fields; free text last)
  encodeCanonicalLines,
  // Simple text-room wires. Pass your scheme string for wire stability.
  signTextChat, verifyTextChat, signTextReaction, verifyTextReaction,
  // Pure merge rules for edits/deletes/reactions
  isAcceptableRevision, mergeReactionsByActorKey, applyToggleReaction,
  // Progressive media (text-first: no capture until enableMic / enableCamera)
  createRoomMedia,
  // Attention (gesture-primed AudioContext)
  primeAttentionAudio, playMatchChime, playNotificationChime, formatUnreadTitle,
} from '@peerly/core'
import { useRoomMedia } from '@peerly/core/react'
```

Peerly workspaces keep a richer signed history format (`peerly-msg-v1/v2`) in
the app, but build those bytes with `encodeCanonicalLines` and reuse the same
revision/reaction merge helpers.

## OIDC verification (browser-only)

```ts
import {
  renderGoogleSignInButton,
  verifyGoogleIdToken, // preferred for Google — issuers + JWKS pinned
  verifyOidcIdToken,   // generic IdP
  GOOGLE_ISSUERS,
  GOOGLE_JWKS_URL,
} from '@peerly/core'

const nonce = await device.publicKeyId() // bind the token to this device key
const token = await renderGoogleSignInButton(container, nonce, clientId)

// Google path (simplest)
const claims = await verifyGoogleIdToken(token, {
  expectedAudience: clientId,
  expectedNonce: nonce,
})

// Or any OIDC issuer
// await verifyOidcIdToken(token, { expectedAudience, expectedNonce, issuers, fetchJwks })
```

Both verifiers check the RS256 signature against the issuer's JWKS, pin exact
issuers, require a **verified** email claim, and reject tokens whose nonce
doesn't match the presenting device key — all client-side; the token never
leaves the browser.

## UI / storage helpers

| Export | Purpose |
|--------|---------|
| `getPeerColor(seed)`, `PEER_COLORS`, `avatarInitial(name)` | Deterministic peer bubble color + initials |
| `isSafeAvatarUrl` / `safeAvatarUrl` | Allowlist for rendering peer avatars (`data:image/*` only — blocks remote URL tracking) |
| `processAvatarBlob` / `processAvatarImage` | Resize/compress uploads to a safe data URL |
| `formatClockTime(timestamp)` | Locale-aware `HH:MM` for message timestamps |
| `createKvStore(name)` | Small IndexedDB key-value store |
| `createBlobStore` / `openIndexedDb` | Shared IndexedDB helpers for apps that cache blobs |
| `probeP2pCapability()` | WebRTC self-test (`P2pCapability`) |
| `classifyJoinError(message)` | Map Trystero errors → `password-mismatch` / `needs-turn` / `unknown` |
| `base64UrlToBytes` / `bytesToBase64Url` / `utf8ToBase64Url` / `base64UrlToUtf8` | Base64url codecs |
| `encodeCanonicalLines` | Shared signed-payload encoding |
| `isAcceptableRevision` / `mergeReactionsByActorKey` / `applyToggleReaction` | Message revision + reaction merge |
| `signTextChat` / `verifyTextChat` / … | Simple text-room signed wires |
| `createRoomMedia` / `useRoomMedia` | Progressive mic/camera over a room |
| `primeAttentionAudio` / `playMatchChime` / `formatUnreadTitle` | Tab + sound attention |
| `createPeopleAttestation` / `loadPeopleList` / `encodeSharedPeopleList` / … | Signed personal lists (`block` / `friend`) with optional email + share codes |

Apps that also need remote OIDC photos (e.g. Google) should layer their own
host allowlist on top of `isSafeAvatarUrl` — the core helper deliberately
refuses remote `https://` avatars so a peer cannot force every client to
phone home to an attacker-controlled URL.

### Signed people lists (block / friend)

```ts
import {
  createPeopleAttestation,
  loadPeopleList,
  savePeopleList,
  encodeSharedPeopleList,
  type DeviceSigner,
} from '@peerly/core'

// App-owned scheme keeps wire formats stable across products.
const SCHEME = 'peerly-friend-v1'
const list = loadPeopleList('my-friends-v1', 'my-friends-subs-v1')
const entry = await createPeopleAttestation(signer, SCHEME, {
  kind: 'friend',
  ownerUserId: me,
  subjectUserId: them,
  subjectName: 'Ada',
  subjectEmail: 'ada@example.com', // optional — Peerly captures this at handshake
})
```

HeyHubs uses the same primitive for blocks (and friends without email).
Invite-to-workspace needs a verified email, which only Peerly's handshake
exposes — so cross-app “add friend on HeyHubs → invite on Peerly” works only
when the friend later connects in Peerly and shares email via handshake.

## What this package is not

It carries no opinion about *who may join a room*: Peerly's creator-signed
allow-lists, peer handshakes, and message-history sanitization stay in the app
layer (OIDC token verification is provided, but what a verified identity is
*allowed to do* is your app's decision).
Room-code possession is the only access control here — treat codes like
credentials and share them in URL fragments, never query strings.

## Publishing (maintainers)

Releases go through the `release-core.yml` GitHub Actions workflow (manual
trigger): it lints and tests the repo, bumps **peerly** and **@peerly/core** in
lockstep (patch/minor/major), publishes with npm **Trusted Publishing**, then
opens a **release PR** (main is protected — no direct push) and pushes
`core-v*` / `v*` tags. Merge the PR so `main` matches npm.

| Input | Real release example |
|-------|----------------------|
| `dry_run` | **`false`** (default is `true` — dry-run only) |
| `bump` | `patch`, **`minor`** (e.g. 1.0.0 → 1.1.0), or `major` |

Dry-run still applies the bump in the runner workspace so the tarball is a
*new* version (re-publishing an existing version fails). For a local sanity
check: `cd packages/core && npm run build && npm pack --dry-run` (`prepack`
builds automatically).
