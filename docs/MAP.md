# Repo map

Peerly: encrypted team collaboration (workspaces, chat, files, video calls) as a React SPA. Peers talk over WebRTC; production coordinates through a self-hosted relay, `preview.peerly.cc` through a Worker with Durable Objects.
Per-screen behavior is in [views.md](views.md); DO design in [DURABLE_OBJECTS_ARCHITECTURE.md](DURABLE_OBJECTS_ARCHITECTURE.md); relay and TURN in [relay-deployment.md](relay-deployment.md); structure, deploy and CI in [README.md](../README.md).

## Layout

- `src/` the app. `App.tsx` session bootstrap and workspace routing, `routing.ts`, `config.ts` build config, `session.ts`, `i18n.tsx`.
- `src/collab/` app policy: workspace stores, creator-signed allow-lists (`allowList.ts`), message signing, identity providers, DM and friends stores, mesh (`mesh.ts`).
- `src/components/` UI (join, workspace, chat, files, `VideoCall.tsx`), `src/hooks/` room, collab and auth wiring (`useCollab.ts`, `useRoom.ts`), `src/context/` collab context, `src/protocol/` message types and mappers, `src/realtime/content.ts` DO content client.
- `packages/core/` published `@peerly/core`: generic rooms, signaling, device identity, OIDC checks, media, `worker/` (Google auth, rendezvous, `realtime/` DO runtime), `server/` (relay). The app imports it from source through an alias.
- `worker/index.mjs` production Worker (API routes, assets); `worker/realtime/` Peerly's DO classes (`gateway.mjs`, `lobbyChannel.mjs`, `contentChannel.mjs`, `commands/`); `worker/usageWatch.mjs` with `wrangler.usage-watch.jsonc`.
- `server/` dev and test servers and the production relay (`relay.mjs`, `relay-prod.mjs`). `infra/` coturn, nginx, systemd, firewall for the VPS.
- `e2e/` Playwright specs, `scripts/` bundle and CSP guards, relay checks, version bump. `docs/` implementation notes.
- Configs: `wrangler.jsonc` (production), `wrangler.preview.jsonc` (staging with DOs; the only config with DO migrations), `wrangler.e2e.jsonc`, `vitest.config.ts`, `vitest.workers.config.ts`, `playwright*.config.ts`.

## Main flows

- Sign-in: `src/collab/providerSignIn.ts` -> provider ID token -> `/api/auth/google/*` (`packages/core/worker/googleAuth.mjs`) or verified in the browser -> device key in IndexedDB.
- Production chat: `src/hooks/useRoom.ts` -> `@peerly/core` `joinRoom` -> relay `wss://relay.peerly.cc` signaling -> WebRTC peers; messages signed (`src/collab/messageSigning.ts`), stored in localStorage.
- Network credentials: `/api/network/credentials` (`worker/index.mjs`) -> relay tickets and TURN credentials.
- Preview (DO mode): `src/realtime/content.ts` -> `/api/realtime/*` -> `handleRealtimeRoute` -> `UserGateway`, lobby and content channel DOs (`worker/realtime/`) -> DO SQLite.
- Calls and files: `VideoCall.tsx` and `FilesPanel.tsx` over WebRTC, never through the Worker.

## @codefusion-cc packages

Only `console` (dev tool, run as `codefusion-console cloudflare <scopes> -- <command>` for Cloudflare commands). Shared product code is `@peerly/core` in `packages/core`.

## Tests and checks

- Typecheck `npm run typecheck`; lint `npm run lint` (oxlint); build `npm run build` (also bundle and size guards).
- Unit (jsdom, `src/`, `packages/core/src`, `worker/**/*.test.mjs`): `npm test -- --maxWorkers=2`. Worker (workerd, `*.workers.test.*` in `packages/core/worker/realtime`): `npm run test:workers`; `npm run worker:check` after changing a wrangler config.
- E2E (Playwright): `npm run test:e2e` (local relay), `npm run test:e2e:do` (built app behind the real Worker and DOs), `npm run test:a11y`. Slow, optional: `test:mutation`.
- CI (`.github/workflows/ci.yml`) also runs audit, coverage, `check:csp`.

## Deploy and migrations

- Merge to `main`: the `deploy production` job in `ci.yml` builds with the relay settings and runs `wrangler deploy` to https://peerly.cc, then checks the served entry script.
- Staging `preview.peerly.cc` is manual: `codefusion-console cloudflare workers:edit,domains:edit -- npm run deploy:preview` (README "Durable Objects control plane"). Output goes to `dist-preview/`.
- DO migrations exist only in `wrangler.preview.jsonc` until the production cutover (`docs/DURABLE_OBJECTS_CUTOVER.md`); there is no SQL database.
- `@peerly/core` releases: manual `release-core.yml` (npm Trusted Publishing).

## Gotchas

- `VITE_APP_ID=peerly` is needed for vite, tsc and tests; use the npm scripts, not bare `npx`.
- Do not put a DO `migrations` block in `wrangler.jsonc` before the cutover: non-main branch builds use `versions upload`, which Cloudflare rejects with migrations.
- Workspace semantics (allow-lists, handshakes, history sanitization) stay in `src/collab`, not in `packages/core`. Generic code goes to the package.
- Node 24.18.0 / npm 11.16.0 are enforced (`.nvmrc`, `.npmrc`, CI); a mismatch exits early.
- Google sign-in on branch previews needs `VITE_GOOGLE_AUTH_BRIDGE_ORIGIN` (README "Testing branches with Google sign-in").
