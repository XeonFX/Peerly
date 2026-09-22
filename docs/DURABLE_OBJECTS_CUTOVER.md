# Peerly Durable Objects cutover

Production is currently configured for `COORDINATION_BACKEND=legacy-relay`
and `CONTENT_BACKEND=p2p`. The independent `preview.peerly.cc` Worker runs
both coordination and content on Durable Objects. This runbook covers Peerly;
HeyHubs has its own repository, bindings, and rollout procedure.

## Before changing production

Use one reviewed commit for the browser and Worker. Run:

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm run test:workers
npm run build
npm run build:preview
npm run worker:check
npm run check:csp
npm run test:e2e
npm run test:e2e:do
```

The DO browser suite uses a real local Worker and SQLite objects with a test
identity provider. It does not prove real Google OAuth configuration, public
DNS, or TURN across two networks. Check those separately on preview with two
devices, including one cellular connection. Verify the live version/commit.

In preview, exercise sign-in, friend discovery and encrypted invitations,
chat and reactions, channel rename/deletion, a fresh browser replaying content
with other members offline, lost-ACK retry, device revocation with sockets
open, file transfer, and calls. Confirm public presence contains a certificate
and never an OIDC ID token or email claim. Complete the preview soak/exit
criteria in `DURABLE_OBJECTS_ARCHITECTURE.md` before promoting the backend.

Verify the required secrets exist on the target Worker:

- `NETWORK_SESSION_SECRET` and `OPAQUE_USER_ID_SECRET` for account sessions.
- `RENDEZVOUS_SECRET` for opaque discovery IDs and short-lived public-lobby
  certificates. Rotating it invalidates both; coordinate browser refreshes.
- `TURN_AUTH_SECRET`, matching the TURN server, and the intended `TURN_URLS`.
- Keep legacy relay ticket secrets/configuration available for rollback.

Provider client IDs, allowed origins, and JWKS configuration must match the
deployed hostname. Copy the `AUTH_RATE_LIMITER` and `AUTH_IP_RATE_LIMITER`
policies from preview using production namespace IDs; retain the existing
`RENDEZVOUS_RATE_LIMITER`. Never copy secret values into JSONC or logs.

## 1. Create the four production namespaces

Add bindings for all four exported classes in a dedicated production change:

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "USER_GATEWAYS", "class_name": "UserGatewayDO" },
    { "name": "SIGNAL_SCOPES", "class_name": "SignalScopeDO" },
    { "name": "CONTENT_CHANNELS", "class_name": "ContentChannelDO" },
    { "name": "LOBBY_CHANNELS", "class_name": "LobbyChannelDO" }
  ]
},
"migrations": [
  {
    "tag": "realtime-v1",
    "new_sqlite_classes": [
      "UserGatewayDO", "SignalScopeDO", "ContentChannelDO", "LobbyChannelDO"
    ]
  }
]
```

This initial migration is only for a production Worker with no applied DO
migrations. Inspect its migration history first. For an existing deployment,
append a new tag for missing classes; never rewrite an applied tag. Do not
copy preview's deleted `WorkspaceDO` or edit preview's historical tags.
Channel state and session-subscriber tables are idempotent SQLite schema
upgrades inside existing objects, not new namespace migrations.

Keep both runtime backends on `legacy-relay`/`p2p` at this stage. Regenerate
the production binding types, run the gates above, and merge the reviewed
configuration before a full production deployment. The configured branch
version-upload path cannot apply migrations; a version upload is not proof
that namespaces were created. Remove the obsolete no-migrations comment in
`wrangler.jsonc` as part of this production configuration change.

Confirm all namespaces exist and the current production app still works.

## 2. Deploy matching browser and Worker settings

The four values are a single release configuration:

| Setting | Browser build | Worker runtime |
|---|---|---|
| Coordination | `VITE_SIGNALING=durable-objects` | `COORDINATION_BACKEND=durable-objects` |
| Content | `VITE_CONTENT_BACKEND=durable-objects` | `CONTENT_BACKEND=durable-objects` |

Set both runtime values in production `wrangler.jsonc`, then build the normal
production artifact with both browser values. Vite variables are substituted
at build time; setting Worker `vars` cannot update an already-built browser.

```sh
VITE_SIGNALING=durable-objects VITE_CONTENT_BACKEND=durable-objects npm run build
npm run worker:check
npm run check:csp
```

Deploy the reviewed production configuration and `dist/` together through the
production deployment path. Do not deploy `dist-e2e/`, which contains a test
issuer. Keep `dist-preview/` and preview's custom domain separate.

If coordination is intentionally rolled out first, still deploy
`LOBBY_CHANNELS`: DO discovery selects that route whenever coordination uses
DO, even if message content remains P2P. Make the content phase an explicit
second release with both content flags changed together.

## 3. Verify and observe

Check these before declaring success:

- `/api/network/enroll` and `/api/network/session` succeed for valid devices.
- `/api/realtime/control`, `/api/realtime/lobby/peerly-lobby-v1`, and authorized
  `/api/realtime/content/<route>` upgrades succeed.
- `/api/rendezvous/presence` issues a token-free certificate;
  `/api/rendezvous/verify` rejects tampering, expiry, and other origins.
- Two accounts exchange messages. A fresh browser receives the channel
  definition and recent history while the original devices are offline.
- Channel deletion remains deleted after stale-device resync. Metadata is
  retained independently of the rolling history budget (1,000 events per
  workspace/DM object, 30 days). Current state has a 1,000-entity bound,
  including deletion records; reaching it returns an error, never eviction.
- A lost ACK leaves a visible, persistent pending message. Reload and retry
  keep the same message ID and produce one logical message.
- Revocation closes content/lobby sockets before the server ACK. A failed
  request remains visible and queued through reload/reconnect.
- Files and calls work between separate networks; TURN is still required.
- Storage failure shows a warning and unsaved in-memory history can be
  exported before the tab is closed. The pending-message outbox uses IndexedDB.

Watch auth errors, upgrade errors, ACK latency, reconnects, revocation errors,
state-capacity responses, and DO usage. Logs must omit provider tokens, email
claims, room secrets, and message contents. Keep the legacy relay running
through the observation period.

## Rollback

Restore the browser and runtime together:

- `VITE_SIGNALING=ws-relay`, `VITE_CONTENT_BACKEND=p2p` during `npm run build`.
- `COORDINATION_BACKEND=legacy-relay`, `CONTENT_BACKEND=p2p` in the Worker.

Deploy that matched artifact/configuration and verify fresh and existing
browser sessions. Keep DO bindings and applied migration history intact;
rollback does not require deleting namespaces or stored content. Recent
DO-only history is not automatically copied into offline P2P browsers, so
preserve the namespaces and explain any temporary history-availability gap.
Keep the public-lobby privacy fix in the rollback build as it also protects
the relay backend. Never roll back to a token-broadcasting client.

Retire the relay only after a successful observation period and an explicit
decision to remove this rollback path. Do not retire coturn with it.
