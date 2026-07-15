# Peerly

Serverless peer-to-peer team collaboration — channels, chat, file sharing, and video calls over WebRTC. Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/), and [Trystero](https://github.com/dmotz/trystero). No central server stores your messages or files.

**v0.1.1** — invite-only workspaces, verified identity, multi-workspace switching, DaisyUI redesign.

## Features

- **Invite-only workspaces** — high-entropy workspace ID (in the URL fragment) doubles as the encryption secret; share the invite link to grant access
- **Multiple workspaces** — joined workspaces are remembered per browser; sign in once, pick a workspace from the join screen, and switch later without the invite link
- **Identity separate from workspace** — sign out of a workspace without losing your identity; leave and return to the picker still signed in
- **Verified identity** — sign in with Google, Microsoft, Apple, or generic OIDC; peers verify JWTs client-side via JWKS
- **Creator-signed allow-list** — only invited email addresses can join; enforced cryptographically in the P2P handshake
- **Creator-only invites** — only the device that created a workspace can add members to the allow-list; anyone can copy the invite link
- **Device-bound auth** — ECDSA challenge-response prevents replayed identity tokens
- **Channels & DMs** — scoped messaging over one encrypted P2P room
- **File transfer & video** — WebRTC data channels and media streams
- **Offline-first storage** — history and files in IndexedDB; rejoin sync from peers
- **Build stamp** — version and git commit shown in the UI so you can confirm what is deployed

## Quick start

Requires **Node 22** (see `.nvmrc`). The lockfile is generated for npm 10; using Node 24/npm 11 locally can break `npm ci` on CI and Cloudflare.

```bash
git clone https://github.com/XeonFX/Peerly.git
cd Peerly
npm install
cp .env.example .env   # add at least one identity provider (see below)
npm run dev
```

Open the printed URL in two browser tabs (or share an invite link). Peers connect in a few seconds over public Nostr signaling.

```bash
npm run dev:relay   # local WebSocket relay instead of Nostr (offline / CI-like)
npm run stop        # kill common dev ports
```

### First-time flow

1. **Sign in** with a configured identity provider.
2. **Create a workspace** (name + initial member emails) or **join** via an invite link (`#invite=…` in the URL).
3. Share the invite link from the sidebar; only the creator's device can add more emails to the allow-list.

The workspace secret never appears in the UI — it lives only in the invite link fragment and local storage.

## Identity providers (required for production)

Workspace access is decided by the **verified email** on an ID token, so a
provider only works here if it (a) issues a signed OIDC ID token in the browser,
(b) includes the user's email, (c) asserts that email is verified, and (d)
supports `nonce` (which binds the token to your device key). Set **at least one**
in `.env`, then restart the dev server.

| Provider | Variables | Notes |
|----------|-----------|-------|
| Google | `VITE_GOOGLE_CLIENT_ID` | Simplest. Works out of the box. |
| Microsoft | `VITE_MICROSOFT_CLIENT_ID`, `VITE_MICROSOFT_TENANT_ID` | Tenant is **required**; needs `email` + `xms_edov` optional claims. |
| Apple | `VITE_APPLE_CLIENT_ID`, optional `VITE_APPLE_REDIRECT_URI` | Needs a Services ID + verified domain. |
| Generic OIDC | `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_ISSUER`, optional `VITE_OIDC_LABEL` | IdP must allow implicit `id_token` for a SPA. |

### Google

1. [Google Cloud console](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID → Web application**.
2. **Authorized JavaScript origins**: every origin the app is served from — `http://localhost:5173` for dev, plus your production origin. No redirect URI is needed (Google Identity Services returns the token via callback).
3. Configure the OAuth consent screen (External is fine; while in *Testing* only listed test users can sign in).
4. Copy the client ID → `VITE_GOOGLE_CLIENT_ID`.

### Microsoft

1. [Entra portal](https://entra.microsoft.com) → **App registrations → New registration**.
2. **Supported account types**: *Accounts in this organizational directory only*. Multi-tenant is refused at startup — see the security note below.
3. **Redirect URI**: platform **Single-page application**, value = your exact origin (`http://localhost:5173`, and your production origin).
4. **Authentication → Implicit grant**: tick **ID tokens**.
5. **Token configuration → Add optional claim → ID** → add both **`email`** and **`xms_edov`**.
6. Copy *Application (client) ID* → `VITE_MICROSOFT_CLIENT_ID`, and *Directory (tenant) ID* → `VITE_MICROSOFT_TENANT_ID`.

Step 5 is not optional. Azure never emits the standard `email_verified`; `xms_edov`
("email domain owner verified") is its equivalent, and without it no Microsoft
user can be admitted. Step 2 matters because Azure lets a tenant admin set an
account's `email` to any unverified value — with multi-tenant, anyone could
register a free tenant, assert one of your members' addresses, and walk in
(Microsoft's documented ["nOAuth"](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference) abuse). Pinning one tenant reduces that to
"an admin of your own directory", who you already trust.

### Apple

1. [Apple Developer](https://developer.apple.com/account/resources/identifiers/list/serviceId) → **Identifiers → Services IDs** → create one (e.g. `com.example.peerly`).
2. Enable **Sign in with Apple**, then **Configure**: add your domain and a **Return URL** matching your origin. Apple requires a verified domain and **does not accept `localhost`** — for local dev use a tunnel, or just use Google.
3. Services ID → `VITE_APPLE_CLIENT_ID`; set `VITE_APPLE_REDIRECT_URI` if it differs from `window.location.origin`.

### Generic OIDC (Okta, Auth0, Keycloak, Entra ID as OIDC, …)

1. Create a **SPA / public client** in your IdP.
2. Allow **implicit `id_token`** and the `openid profile email` scopes; redirect URI = your origin.
3. Ensure the ID token carries `email` **and** `email_verified` — the app rejects tokens without a verified email.
4. `VITE_OIDC_ISSUER` = the issuer URL (the app reads `<issuer>/.well-known/openid-configuration`), `VITE_OIDC_CLIENT_ID` = the client ID.

### Why GitHub is not supported

GitHub does not implement OIDC for user sign-in. Its
[discovery document](https://github.com/login/oauth/.well-known/openid-configuration)
advertises `claims_supported: [sub, aud, exp, nbf, iat, iss, act]` — **no `email`
and no `nonce`** — and there is no `userinfo_endpoint`. Its plain OAuth returns an
*opaque* access token instead, which a peer cannot verify without a server (and
only by handing that server the token). Both are load-bearing here, so GitHub
cannot be supported without changing the trust model. It was removed rather than
left as a button that always fails.

## Signaling

Browsers need a **signaling channel** to discover each other (WebRTC handshake). Application data stays P2P afterward.

| Mode | When | Config |
|------|------|--------|
| **Nostr** (default) | Dev & deploy — no server | None |
| **ws-relay** | Offline / local CI | `npm run dev:relay` or `VITE_SIGNALING=ws-relay` |
| **Supabase** | Relay you control | `VITE_SIGNALING=supabase` + Supabase URL/key |

`npm run test:e2e` uses a local relay (many connections from one IP would throttle public Nostr relays). `npm run test:e2e:nostr` runs a subset against public relays.

### TURN (optional)

For strict NAT / corporate firewalls, add your own TURN server:

```bash
VITE_TURN_URLS=turn:your-turn.example:3478 \
VITE_TURN_USERNAME=user \
VITE_TURN_CREDENTIAL=pass \
npm run build
```

## Deploy

Peerly is a **static SPA**. Build once, serve `dist/` from any static host.

```bash
npm run build
```

Output goes to `dist/`. The build runs a bundle guard that fails if E2E test key material leaked into the production bundle.

### Cloudflare Pages (recommended)

Use **Pages**, not Workers. Ignore the auto-generated "Cloudflare Workers configuration" PR — that targets `wrangler deploy` and is the wrong model for this app.

| Setting | Value |
|---------|--------|
| Framework preset | None (or Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(repo root)* |
| Node version | `22` (or env var `NODE_VERSION=22`) |
| Deploy command | *(leave empty)* |

**Environment variables** (Production → Settings → Environment variables):

```
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Add TURN, signaling overrides, or other providers as needed (see `.env.example`).

Register your production origin (`https://your-project.pages.dev` and any custom domain) in each OAuth provider's allowed JavaScript origins / redirect URIs.

Cloudflare injects `CF_PAGES_COMMIT_SHA` at build time, which appears in the UI as `v0.1.1 · abc1234`.

### Other hosts

Vercel, Netlify, S3 + CloudFront, etc. work the same way: `npm run build`, publish `dist/`, set `VITE_*` env vars at build time, register OAuth origins.

## Tech stack

| Layer | Choice |
|-------|--------|
| UI | React 19, Tailwind CSS 4, DaisyUI 5 (custom `peerly` dark theme) |
| Build | Vite 8, TypeScript 6 |
| P2P | Trystero (`@trystero-p2p/*`) — Nostr / ws-relay / Supabase signaling |
| Crypto | Web Crypto — ECDSA device keys, JWT verification via JWKS, creator-signed allow-lists |
| Storage | localStorage (session, workspace list), IndexedDB (device keys, files, avatars) |
| Tests | Vitest (unit), Playwright (E2E), oxlint |

## Project structure

```
.
├── e2e/                    Playwright end-to-end tests
├── public/                 Static assets (favicon, etc.)
├── scripts/
│   ├── guard-bundle.mjs    Fail build if E2E keys reached dist/
│   └── check-relays.mjs    Nostr relay health diagnostic
├── server/                 Dev relay, test server, process helpers
│   ├── dev.mjs             npm run dev (Nostr signaling)
│   ├── dev-relay.mjs       npm run dev:relay
│   ├── relay.mjs           WebSocket signaling relay
│   └── test-server.mjs     E2E: relay + Vite with auth bypass
├── src/
│   ├── collab/             P2P protocol, crypto, identity, stores
│   ├── components/         React UI (join screen, sidebar, chat, video)
│   ├── hooks/              Room, collab, auth wiring
│   ├── protocol/           Message types & mappers
│   ├── utils/              Storage, blobs, hashing
│   ├── index.css           Tailwind + DaisyUI theme
│   ├── App.tsx             Session bootstrap, workspace routing
│   ├── config.ts           Room / relay / build label
│   └── session.ts          Active workspace session persistence
├── build-info.mjs          Version + commit injected at build time
├── .env.example            Environment template (copy to .env)
├── .nvmrc                  Node 22 (lockfile / CI alignment)
├── playwright.config.ts
├── vite.config.ts
└── vitest.config.ts
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite + public Nostr signaling |
| `npm run dev:relay` | Vite + local WebSocket relay |
| `npm run build` | Typecheck + production build + bundle guard |
| `npm test` | Vitest unit tests (140 tests) |
| `npm run test:e2e` | Playwright E2E (34 tests, local relay) |
| `npm run test:e2e:nostr` | E2E subset over public Nostr |
| `npm run check:relays` | Health-check the default Nostr relays |
| `npm run guard:bundle` | Fail if test key material reached `dist/` (runs in `build`) |
| `npm run lint` | oxlint |

The app shows its version and commit (`v0.1.1 · a1b2c3d`) on the join screen and
in the sidebar footer. Hosts that expose a commit SHA
(`CF_PAGES_COMMIT_SHA`, `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, …) are picked up
automatically; otherwise it falls back to local git.

`check:relays` is a diagnostic, not part of `npm test` — a third-party relay
going down shouldn't fail your build. Run it after editing
`DEFAULT_NOSTR_RELAYS`: a relay that merely opens a socket can still silently
drop the ephemeral events Trystero signals with, which looks identical to
working until two peers fail to find each other.

## Security model

- **Invite link = credential** — workspace ID lives in the URL hash (never sent to servers in HTTP requests)
- **Identity handshake** — three-round P2P verification: OIDC JWT + allow-list signature + live device-key proof
- **No server-side enforcement** — allow-list is creator-signed; peers verify signatures and JWTs locally
- **Inviting is creator-only** — the allow-list is only accepted if it verifies against the workspace's creator key, and that key never leaves the browser profile that created the workspace. A second device, even the creator's, cannot add members.
- **No revocation** — adding works because a signed allow-list is a capability: presenting a newer one that names you gets you in. That same property means anyone once invited keeps a validly signed list naming them, so removal is not offered rather than implied and unenforced.
- **Live messages** — attributed by transport peer id, not payload `senderId`
- **History sync** — rejoin history is not per-message signed today; treat synced history as trusted only among members you trust
- **Production bundle guard** — E2E fake-issuer keys are isolated and scanned out of `dist/` on every build

## CI

GitHub Actions on push/PR to `main` / `master` (see [.github/workflows/ci.yml](.github/workflows/ci.yml)):

1. `npm ci` (Node 22)
2. lint
3. unit tests
4. production build
5. Playwright E2E (local relay)

## License

MIT — see [LICENSE](LICENSE).