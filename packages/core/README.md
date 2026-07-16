# @peerly/core

The P2P room core of [Peerly](https://github.com/XeonFX/Peerly) — join encrypted
[Trystero](https://github.com/dmotz/trystero) rooms by high-entropy room codes,
with device identity, signing primitives, and signaling-strategy selection.
No application server: signaling (Nostr by default) is used only so browsers can
find each other; everything after the handshake is direct WebRTC.

Extracted from and battle-tested by Peerly's invite-only team workspaces. MIT.

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

const hello = room.makeAction<string>('hello')
hello.onMessage = (msg, { peerId }) => console.log(peerId, msg)
room.onPeerJoin = peerId => void hello.send('hi', { target: peerId })
```

Functions never read `import.meta.env` themselves — Vite substitutes that
per-bundle, so a library cannot see the app's values. Pass your env (or any
plain object) where a function takes `env`.

## React

```tsx
import { useRoom } from '@peerly/core/react'

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
}
```

The hook carries Peerly's hard-won teardown handling: `leave()` is async and
Nostr batches relay subscriptions across rooms, so a leave landing after the
next join silently kills that room's signaling. The hook serializes them —
StrictMode remounts and room switches just work.

## Signaling strategies

| Strategy | When | Config |
|----------|------|--------|
| `nostr` (default) | No server, public relays | none — curated `DEFAULT_NOSTR_RELAYS`, override `VITE_NOSTR_RELAYS` |
| `ws-relay` | Offline / CI / local relay | `VITE_SIGNALING=ws-relay`, `resolveRelayUrls(env)` |
| `supabase` | A relay you control | `VITE_SIGNALING=supabase` + `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` |

TURN for strict NATs: `VITE_TURN_URLS`, `VITE_TURN_USERNAME`,
`VITE_TURN_CREDENTIAL` (see `getTurnConfig`).

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

## OIDC verification (browser-only)

```ts
import { renderGoogleSignInButton, verifyOidcIdToken } from '@peerly/core'

const nonce = await device.publicKeyId() // bind the token to this device key
const token = await renderGoogleSignInButton(container, nonce, clientId)
const claims = await verifyOidcIdToken(token, {
  expectedAudience: clientId,
  expectedNonce: nonce,
  issuers: new Set(['https://accounts.google.com', 'accounts.google.com']),
  fetchJwks: async () => (await fetch('https://www.googleapis.com/oauth2/v3/certs')).json(),
})
```

`verifyOidcIdToken` checks the RS256 signature against the issuer's JWKS,
pins exact issuers, requires a **verified** email claim, and rejects tokens
whose nonce doesn't match the presenting device key — all client-side, no
token ever leaves the browser.

Also exported: `probeP2pCapability()` (WebRTC self-test), `createRelayHealth()`
(live relay socket visibility), `classifyJoinError()` (password mismatch vs.
needs-TURN vs. unknown), `createKvStore` (IndexedDB KV), and base64url helpers.

## What this package is not

It carries no opinion about *who may join a room*: Peerly's creator-signed
allow-lists, peer handshakes, and message-history sanitization stay in the app
layer (OIDC token verification is provided, but what a verified identity is
*allowed to do* is your app's decision).
Room-code possession is the only access control here — treat codes like
credentials and share them in URL fragments, never query strings.

## Publishing (maintainers)

Releases go through the `release-core.yml` GitHub Actions workflow (manual
trigger): it lints and tests the repo, bumps the version (patch/minor/major),
publishes with npm **Trusted Publishing** + provenance, and commits the bump
back to `main`. Run it with `dry_run=true` first to inspect the tarball.

For a local sanity check: `cd packages/core && npm run build && npm pack --dry-run`
(`prepack` builds automatically).
