# Peerly

Serverless peer-to-peer team collaboration — channels, chat, progressive file sharing, and video calls over WebRTC. Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/), and [Trystero](https://github.com/dmotz/trystero). Peerly has no application backend that stores workspace messages or files; signaling services are used only to help browsers discover each other.

Highlights: the P2P room core ships as the npm package [`@peerly/core`](packages/core), reusable by other apps — alongside messenger attention, signed message actions, rich file/call workflows, channel management, an installable offline shell, URL routing, complete English/Polish UI, and accessibility hardening. The running app always shows its exact version and commit in the UI.

**Live app:** [peerly.cc](https://peerly.cc)

Per-screen behavior, routes, and major functions:
**[docs/views.md](docs/views.md)**.

## Features

- **Invite-only workspaces** — a high-entropy workspace ID in the URL fragment doubles as the room encryption secret; share the full signed invite to grant access
- **Multiple workspaces** — joined workspaces are remembered per browser; sign in once, pick a workspace from the join screen, and switch later without the invite link
- **Workspace appearance** — rename a workspace and upload a custom icon from workspace settings; stored locally per browser and shown in the sidebar and picker
- **Light and dark themes** — follows the operating-system preference by default and stores an explicit choice per device
- **Identity separate from workspace** — leave a workspace without losing your identity; return to the picker while remaining signed in
- **Verified identity** — sign in with Google, Microsoft, Apple, or generic OIDC; peers verify JWTs client-side via JWKS
- **Creator-signed allow-list** — only invited email addresses can join; enforced cryptographically in the P2P handshake
- **Creator-only invites** — only the device that created a workspace can add members to the allow-list; anyone can copy the invite link
- **Device-bound auth** — ECDSA challenge-response prevents replayed identity tokens
- **Session continuity** — warns before the current ID token expires and offers same-account reauthentication so new peer handshakes keep working
- **Managed channels & DMs** — scoped messaging over one encrypted P2P room, with channel rename/delete/reorder and locally closable DM threads
- **Reader-friendly history** — incoming messages do not pull you away from older history; a new-message pill returns to the latest messages
- **Messenger attention** — unread totals update the tab title and favicon; users can explicitly opt into background DM notifications and local attention sounds, including an incoming-call ringtone
- **Signed message actions** — HTTPS links are safely linkified; authors can edit/delete with signed revisions, and reactions carry their own identity-bound signatures
- **Fast file input** — attach multiple files, paste clipboard images/files, or drag files onto the composer; selections process sequentially to cap peak memory
- **Progressive file sync** — text and thumbnails sync first; full-size file bodies download on demand by default, with a device-wide automatic mode available
- **Storage visibility** — approximate browser quota, available space, pressure warnings, per-workspace usage, and separate actions for freeing cached originals or clearing local history
- **Workspace backups** — exports signed workspace-channel history and access as JSON, then safely merges it back from the workspace picker
- **Local sensitive-media screening** — NSFWJS checks image/video attachments and samples remote video streams locally; flagged media stays hidden until revealed
- **Video calls** — incoming-call awareness, screen sharing, camera/microphone selection, and WebRTC media with TURN support for strict networks
- **Installable offline shell** — a service worker caches the production app shell and loaded release assets so local history remains reachable without signaling
- **English and Polish UI** — the device language preference covers navigation, settings, chat, files, calls, storage, invites, confirmations, placeholders, and accessibility labels
- **Accessibility hardening** — deterministic view focus, polite incoming-message announcements, clearer light-theme contrast, and motion-aware navigation
- **Connectivity diagnostics** — distinguishes local WebRTC availability, a verified peer connection, signaling failure, and paths that need TURN
- **Build stamp** — version and git commit shown in the UI so you can confirm what is deployed

## Quick start

Requires **Node 24.x and npm 11.x** — the majors that wrote the lockfile. Majors are what matter: different npm MAJOR releases can rewrite optional dependency records incompatibly, while patch releases do not. Exact-patch pins were tried and abandoned twice — they turn any tool-mirror gap into a failed install (Cloudflare's builder could not fetch one specific patch and every deploy failed).

```bash
nvm install 24
nvm use 24
npm --version            # must print 11.x
git clone https://github.com/XeonFX/Peerly.git
cd Peerly
npm ci
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

### Sync and browser storage

The default **on-demand** mode is designed for fast joins and constrained browser storage:

1. Channel and message history syncs first.
2. File metadata and small WebP thumbnails travel with history.
3. Full-size file bodies download only when opened.

Workspace settings can enable **Auto-download full files** for every workspace on that device. Automatic downloads pause when browser storage reaches warning or critical pressure; text and metadata sync keep working. The storage card uses `navigator.storage.estimate()`, so quota and available-space values are approximate and browser-specific.

Storage actions are local:

- **Free local space** removes reclaimable cached originals while retaining messages, previews, and the metadata needed to request files again.
- **Clear local history** removes that workspace's messages, previews, read state, and cached bodies that no other local workspace references while retaining workspace access.

Neither action deletes content from other members. Re-sync requires at least one peer with the relevant history or file body to be online; Peerly has no global cloud archive.

**Export backup** in workspace settings saves the newest 500 messages from each workspace channel together with channel structure and signed workspace access. Protect the JSON like an invite link. Imports verify the creator-signed allow-list and message signatures, bound untrusted data, and merge without overwriting local messages. DMs and full-size file bodies are excluded.

### Sensitive-media screen

NSFWJS and its MobileNetV2 model are loaded lazily only when visual media needs checking. Classification runs locally through a single inference queue; sampled video frames are neither uploaded nor persisted. Shared images, video-file samples, and visible remote video streams can be blurred behind a reveal action.

This is a receiver-side privacy aid, not moderation or access control. Classification deliberately fails open when the model or browser graphics backend is unavailable, and a modified peer can bypass its own outbound checks.

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

When a Google token approaches expiry, Peerly prepares a fresh same-account sign-in button in the workspace banner. [Google Identity Services does not provide a truly silent sign-in flow](https://developers.google.com/identity/gsi/web/guides/offerings); credentials are returned through privacy-preserving automatic or manual UI.

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
| **Nostr** (default) | Dev & deploy — public signaling, no application server | None |
| **ws-relay** | Offline / local CI | `npm run dev:relay` or `VITE_SIGNALING=ws-relay` |
| **Supabase** | Relay you control | `VITE_SIGNALING=supabase` + Supabase URL/key |

`npm run test:e2e` uses a local relay (many connections from one IP would throttle public Nostr relays) and runs 4 workers in parallel — each worker gets its own workspace/room, so tests never meet each other. `npm run test:e2e:nostr` runs a small subset against public relays, deliberately serial.

Deployment owners can replace the curated Nostr set with the build-time `VITE_NOSTR_RELAYS` variable. Peerly does **not** currently expose relay editing to end users: members need at least one signaling relay in common, so a safe user-facing design must distribute a workspace relay profile rather than silently changing one device.

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

### Cloudflare Workers Static Assets (recommended)

The committed [`wrangler.jsonc`](wrangler.jsonc) deploys `dist/` as an assets-only Worker and returns `index.html` for SPA navigation routes. No server-side Worker code runs for requests.

| Setting | Value |
|---------|--------|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` (default) |
| Non-production deploy | `npx wrangler versions upload` (default) |
| Root directory | *(repo root)* |
| Node version | `24` via `.nvmrc` (any 24.x the builder has) |

The connected Worker must be named `peerly`, matching `wrangler.jsonc`. The default deploy commands obtain Wrangler through `npx`; it is intentionally not installed as an application dependency.

Cloudflare may print its image-default `npm@10.9.2` during initial tool detection. Installing the `.nvmrc` Node 24 override then exposes that runtime's bundled npm 11.x, which is what runs `npm clean-install`. `devEngines` still hard-fails any non-24/non-11 pair before it can touch the lockfile.

**Environment variables** (Production → Settings → Environment variables):

```
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Add TURN, signaling overrides, or other providers as needed (see `.env.example`).

Register the production origin (`https://peerly.cc`) in each OAuth provider's allowed JavaScript origins / redirect URIs. Add the direct `workers.dev` address too if you use it for testing.

Cloudflare injects `WORKERS_CI_COMMIT_SHA` at build time, which appears in the UI as `v<version> · <commit>`.

Cloudflare Pages also works: use `npm run build`, publish `dist/`, and set the same build-time environment variables.

### Testing branches with Google sign-in (preview worker)

Google OAuth requires **exact** JavaScript origins — no wildcards — so
per-branch preview URLs (`<branch>-peerly.<subdomain>.workers.dev`) can never
complete sign-in. Instead, deploy whatever branch you want to test to the one
stable staging worker:

```bash
git checkout <branch-to-test>
npm run build
npx wrangler deploy --env preview   # → https://peerly-preview.<subdomain>.workers.dev
```

One-time setup: add that origin to the OAuth client's authorized JavaScript
origins (next to the production origin) — or, cleaner, create a second OAuth
client just for previews and build with its id
(`VITE_GOOGLE_CLIENT_ID=<preview-client-id> npm run build`), so experiments
never touch the production client. The build-time env comes from your local
`.env`, so a preview deploy uses whatever providers/relays you have configured
there.

### Other hosts

Vercel, Netlify, S3 + CloudFront, etc. work the same way: `npm run build`, publish `dist/`, set `VITE_*` env vars at build time, register OAuth origins.

## Tech stack

| Layer | Choice |
|-------|--------|
| UI | React 19, Tailwind CSS 4, DaisyUI 5 (custom `peerly` light and `peerly-dark` themes) |
| Build | Vite 8, TypeScript 6 |
| P2P | Trystero (`@trystero-p2p/*`) — Nostr / ws-relay / Supabase signaling |
| Crypto | Web Crypto — ECDSA device keys, JWT verification via JWKS, creator-signed allow-lists |
| Storage | localStorage (session, workspace list, messages, indexes), IndexedDB (device keys, file bodies, avatars) |
| Media safety | Lazy NSFWJS MobileNetV2 inference in the browser |
| Tests | Vitest (unit), Playwright (E2E), oxlint |

## @peerly/core

The generic P2P room core — room-code generation, signaling strategy selection,
`joinRoomByCode`, the `useRoom` React hook, device identity, signing
primitives, and browser-side OIDC token verification — lives in
[`packages/core`](packages/core) and is published to npm as
[`@peerly/core`](packages/core/README.md). The app consumes it from source via
a Vite/tsconfig alias; other apps consume the published package.
Workspace semantics — creator-signed allow-lists, peer handshakes, history
sanitization — deliberately stay in the app, not the package. Releases run
through the `release-core.yml` workflow: manual trigger, npm Trusted Publishing
with provenance, automatic version bump committed back to `main`.

## Project structure

```
.
├── e2e/                    Playwright end-to-end tests
├── docs/                   views.md (screens & functions), implementation notes
├── public/                 Static assets (favicon, etc.)
├── scripts/
│   ├── guard-bundle.mjs    Fail build if E2E keys reached dist/
│   ├── check-csp.mjs       Serve dist with CSP, test a negative control + offline shell
│   └── check-relays.mjs    Nostr relay health diagnostic
├── server/                 Dev relay, test server, process helpers
│   ├── dev.mjs             npm run dev (Nostr signaling)
│   ├── dev-relay.mjs       npm run dev:relay
│   ├── relay.mjs           WebSocket signaling relay
│   └── test-server.mjs     E2E: relay + Vite with auth bypass
├── src/
│   ├── collab/             P2P protocol, crypto, identity, stores
│   ├── components/         React UI (join, settings, storage, chat, files, video)
│   ├── hooks/              Room, collab, auth wiring
│   ├── protocol/           Message types & mappers
│   ├── utils/              Storage, blobs, hashing
│   ├── index.css           Tailwind + DaisyUI theme
│   ├── App.tsx             Session bootstrap, workspace routing
│   ├── config.ts           Room / relay / build label
│   └── session.ts          Active workspace session persistence
├── build-info.mjs          Version + commit injected at build time
├── .env.example            Environment template (copy to .env)
├── .nvmrc                  Node 24.18.0 (npm 11.16.0 / CI alignment)
├── playwright.config.ts
├── vite.config.ts
├── wrangler.jsonc          Cloudflare assets-only SPA deployment
└── vitest.config.ts
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite + public Nostr signaling |
| `npm run dev:relay` | Vite + local WebSocket relay |
| `npm run dev:app` | Vite only, using the signaling strategy from the environment |
| `npm run stop` | Stop the common local Peerly development ports |
| `npm run build` | Typecheck + production build + bundle guard |
| `npm test` | Vitest unit/component tests (210 tests) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright E2E (50 tests, local relay, 4 parallel workers) |
| `npm run test:e2e:nostr` | E2E subset over public Nostr |
| `npm run test:e2e:ui` | Playwright interactive UI |
| `npm run preview` | Preview the production build locally |
| `npm run check:relays` | Health-check the default Nostr relays |
| `npm run check:csp` | Verify production CSP, its inline-script negative control, and the offline shell |
| `npm run guard:bundle` | Fail if test key material reached `dist/` (runs in `build`) |
| `npm run lint` | oxlint |

The app shows its version and commit (`v<version> · <commit>`) on the join screen and
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
- **Messages are author-signed** — every message and file announcement is signed with the sender's device key at send time. Signed v2 revisions make edits/deletes tamper-evident, and each reaction is signed independently. Relayed history is verified on import: tampered entries are dropped, and identity claims are honoured only for keys bound to that user in a live handshake.
- **Security headers** — a strict Content-Security-Policy ships via `public/_headers`; CI serves the production bundle with those headers, asserts zero startup violations, and proves its negative control is blocked.
- **Inviting is creator-only** — the allow-list is only accepted if it verifies against the workspace's creator key, and that key never leaves the browser profile that created the workspace. A second device, even the creator's, cannot add members.
- **Revocation is best-effort** — the creator can remove a member, and every device judges peers against the newest creator-signed list it holds, so updated members stop admitting the removed member at their next handshake. The honest limit: the removed member and any member who never received the update can still pair, and open connections are not torn down. Nothing short of a server closes that gap.
- **Live messages** — attributed by transport peer id, not payload `senderId`
- **Legacy history** — unsigned entries from older versions retain readable text but lose durable identity claims; newly authored entries are signed and verified
- **Local media classification** — sensitive-media screening never uploads frames, but it is advisory and fails open rather than acting as a moderation authority
- **Relay metadata** — signaling relays do not receive message/file bodies, but relay and TURN operators can still observe connection metadata such as IP addresses, timing, and traffic volume
- **Production bundle guard** — E2E fake-issuer keys are isolated and scanned out of `dist/` on every build

## Design limits

Consequences of having no server, stated as the trade-offs they are:

- **Deletion is local, by design** — with no authority that owns the data, storage cleanup affects one browser only. A safe workspace-wide reset would need a signed monotonic reset epoch so an offline peer cannot resurrect old state; until then, Peerly does not pretend to a global delete it cannot enforce.
- **You are the archive** — manual JSON backup covers workspace-channel messages and access; DMs and file bodies live in local copies and online peers. No cloud archive is the point, not a gap.
- **Transfers are whole-file** — file bodies are content-addressed and integrity-checked; resumable byte-range transfer is traded away for that simplicity, and join progress is channel-based rather than byte-accurate.
- **Revocation is eventual** — a removed member stops being admitted as devices learn the newer creator-signed list; a stale device honours the old list until it hears the new one. Nothing short of a server closes that gap, and Peerly chooses no server.
- **Relays are deployment-time configuration** — members need at least one signaling relay in common, so per-user relay editing could silently partition a workspace. Overrides exist at build time instead.
- **Moderation stays on your device** — local NSFW screening is advisory, and there is deliberately no workspace-wide block or ban authority: any such authority would be a server with power over content.

## CI

GitHub Actions on push/PR to `main` / `master` (see [.github/workflows/ci.yml](.github/workflows/ci.yml)):

1. Install Node `24.18.0` with its bundled npm `11.16.0`, then verify both exact versions.
2. Run a clean `npm ci` from the committed lockfile.
3. Run lint and 210 unit/component tests.
4. Run the TypeScript/Vite production build and bundle guard.
5. Install Chromium, verify CSP plus the offline shell, and run all 50 Playwright tests against the local relay (2 parallel workers in CI, each with an isolated workspace).

`package.json` `devEngines`, `.npmrc`, `.nvmrc`, and CI all enforce the same toolchain. A mismatched Node or npm exits before it can rewrite `package-lock.json`.

## License

MIT — see [LICENSE](LICENSE).
