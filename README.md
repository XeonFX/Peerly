# Peerly

Serverless peer-to-peer team collaboration — channels, chat, file sharing, and video calls over WebRTC. Built with [React](https://react.dev/) and [Trystero](https://github.com/dmotz/trystero). No central server stores your messages or files.

## Features

- **Invite-only workspaces** — high-entropy workspace ID (in the URL fragment) doubles as the encryption secret; share the invite link to grant access
- **Verified identity** — sign in with Google, Microsoft, GitHub, Apple, or generic OIDC; peers verify JWTs client-side via JWKS
- **Creator-signed allow-list** — only invited email addresses can join; enforced cryptographically in the P2P handshake
- **Device-bound auth** — ECDSA challenge-response prevents replayed identity tokens
- **Channels & DMs** — scoped messaging over one encrypted P2P room
- **File transfer & video** — WebRTC data channels and media streams
- **Offline-first storage** — history and files in IndexedDB; rejoin sync from peers

## Quick start

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

## Identity providers (required for production)

Set **at least one** in `.env`, then restart the dev server:

| Provider | Variables |
|----------|-----------|
| Google | `VITE_GOOGLE_CLIENT_ID` |
| Microsoft | `VITE_MICROSOFT_CLIENT_ID`, optional `VITE_MICROSOFT_TENANT_ID` |
| GitHub | `VITE_GITHUB_CLIENT_ID`, optional `VITE_GITHUB_TOKEN_PROXY` |
| Apple | `VITE_APPLE_CLIENT_ID`, optional `VITE_APPLE_REDIRECT_URI` |
| Generic OIDC | `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_ISSUER`, optional `VITE_OIDC_LABEL` |

See [.env.example](.env.example) for signaling, TURN, and E2E options.

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

```bash
npm run build
```

Deploy the `dist/` folder to any static host (Cloudflare Pages, Vercel, Netlify, S3, etc.). Register your production origin in each OAuth provider's allowed redirect / JavaScript origins.

## Project structure

```
.
├── e2e/                 Playwright end-to-end tests
├── public/              Static assets (favicon, etc.)
├── server/              Dev relay, test server, process helpers
│   ├── dev.mjs          npm run dev (Nostr signaling)
│   ├── dev-relay.mjs    npm run dev:relay
│   ├── relay.mjs        WebSocket signaling relay
│   └── test-server.mjs  E2E: relay + Vite with auth bypass
├── src/
│   ├── collab/          P2P protocol, crypto, identity, stores
│   ├── components/      React UI
│   ├── hooks/           Room, collab, auth wiring
│   ├── protocol/        Message types & mappers
│   ├── utils/           Storage, blobs, hashing
│   ├── App.tsx          Session bootstrap
│   ├── config.ts        Room / relay configuration
│   └── session.ts       Workspace session persistence
├── .env.example         Environment template (copy to .env)
├── playwright.config.ts
├── vite.config.ts
└── vitest.config.ts
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite + public Nostr signaling |
| `npm run dev:relay` | Vite + local WebSocket relay |
| `npm run build` | Typecheck + production build |
| `npm test` | Vitest unit tests (99 tests) |
| `npm run test:e2e` | Playwright E2E (28 tests, local relay) |
| `npm run test:e2e:nostr` | E2E subset over public Nostr |
| `npm run lint` | oxlint |

## Security model

- **Invite link = credential** — workspace ID lives in the URL hash (never sent to servers in HTTP requests)
- **Identity handshake** — three-round P2P verification: OIDC JWT + allow-list signature + live device-key proof
- **No server-side enforcement** — allow-list is creator-signed; peers verify signatures and JWTs locally
- **Live messages** — attributed by transport peer id, not payload `senderId`
- **History sync** — rejoin history is not per-message signed today; treat synced history as trusted only among members you trust

## CI

GitHub Actions runs lint, unit tests, build, and E2E on push/PR to `main` / `master` (see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## License

MIT — see [LICENSE](LICENSE).