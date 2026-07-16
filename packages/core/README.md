# @peerly/core

The P2P room core of [Peerly](https://github.com/XeonFX/Peerly) — join encrypted
[Trystero](https://github.com/dmotz/trystero) rooms by high-entropy room codes,
with device identity, signing primitives, and signaling-strategy selection.
No application server: signaling (Nostr by default) is used only so browsers can
find each other; everything after the handshake is direct WebRTC.

Powers Peerly (invite-only team workspaces) and HeyHubs (interest-based
networking). MIT.

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

const [sendHello, onHello] = room.makeAction('hello')
room.onPeerJoin(peerId => sendHello('hi', peerId))
onHello((msg, peerId) => console.log(peerId, msg))
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
  // room is null until joined; stable across re-renders; leaves on unmount
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

Also exported: `probeP2pCapability()` (WebRTC self-test), `createRelayHealth()`
(live relay socket visibility), `classifyJoinError()` (password mismatch vs.
needs-TURN vs. unknown), `createKvStore` (IndexedDB KV), and base64url helpers.

## What this package is not

It carries no opinion about *who may join*: Peerly's creator-signed allow-lists,
OIDC verification, and message-history sanitization stay in the app layer.
Room-code possession is the only access control here — treat codes like
credentials and share them in URL fragments, never query strings.

## Publishing (maintainers)

```bash
cd packages/core
npm run build        # tsc → dist/
npm pack --dry-run   # inspect the tarball
npm publish --access public
```

`prepack` builds automatically. The GitHub Actions workflow
`release-code.yml` does the same with `--provenance` on a manual trigger.
