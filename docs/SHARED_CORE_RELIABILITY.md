# Shared reliability and identity implementation (core 1.16.0)

Peerly and HeyHubs now use the same implementations for these responsibilities:

| Responsibility | Core API | Application responsibility |
| --- | --- | --- |
| Persistent outgoing text messages | `createMessageOutbox`, `createIndexedDbOutboxStorage`, `useMessageOutbox` | Storage namespace, signed payload and transport delivery callback |
| Conversation isolation | `useConversationState`, scoped `useRoom` / `useDurableChannel` | Conversation identity and rendering |
| Failed history writes | `createTextChatHistoryStore`, `useHistoryPersistence` | Message conversion, UI warning and retry control |
| Public identity certificates | `createIdentityClient`, `createIdentityRoutes` | Worker routes, secrets, provider configuration and rate limiter |
| Device proof of possession | `createPeerIdentityHandshake`, `IdentityAttestation` | Expected account/device policy |
| Session revocation and eviction | `defineUserGateway`, `validateChannelSession` | Channel authorization policy and product commands |

The core owns protocol validation, storage and retry behavior. Workspace membership,
HeyHubs matching and moderation, message presentation and app-specific channel
schemas stay in their applications. Combining these policies would make changes
in one product silently affect the other.

## Fixed failures

- Switching Peerly DMs cannot render or rebroadcast the preceding conversation's
  messages. Late callbacks also retain their original conversation generation.
- HeyHubs public lobby, handshakes and new P2P board entries carry a short-lived
  account/device certificate instead of a Google ID token. Historical raw-token
  board entries may still be read locally but are excluded from public gossip.
- Enrolling a fifth device invalidates evicted sessions on content/lobby channels,
  with failed invalidation RPCs retried by the gateway alarm.
- HeyHubs saves signed outgoing text to IndexedDB before clearing the composer.
  P2P delivery waits for a peer, and retry reuses the same message ID. Pending
  messages survive reload and can be cancelled.
- History storage failures return an explicit failure, keep the latest bounded
  room snapshot in memory and expose a retryable warning in both DM interfaces.

Cancellation stops future retries; it cannot recall an already accepted message.
An in-memory history fallback does not survive closing the tab. Text edits,
reactions and file transfer have separate existing delivery semantics; the new
HeyHubs outbox currently covers original outgoing text messages.

## Identity trust and rollout

The same-origin Worker verifies the provider token and device signature, then
attests only the user ID, device public key and validity window. It is an identity
trust authority. Certificates are scoped by origin and protocol purpose; raw
provider tokens are sent only to this Worker, never to public peers. Historical
verification must use the signed message/revision timestamp, never an unsigned
caller-supplied timestamp. New live connections must validate at the current time.

HeyHubs requires the identity routes and `IDENTITY_RATE_LIMITER` in both production
and preview. The issuer uses the deployment's existing relay/session secret with
protocol domain separation. Deploy matching Worker and client code together;
older HeyHubs clients do not understand certificate attestations and must refresh.
No production deployment, npm publication or database migration is performed by
this refactor. Peerly's existing lobby identity exports and routes remain available.

## Reproducible integration before publication

From the Peerly checkout:

```sh
node scripts/pack-core-for-consumer.mjs /path/to/HeyHubs
```

This builds and packs core, writes the archive into HeyHubs `vendor/`, and pins its
package and lockfile to that archive. Commit all three consumer artifacts together.
`npm ci --ignore-scripts` works without unpublished registry dependencies. After
core 1.16.0 is published, replace the file dependency with
`npm install --save-exact @peerly/core@1.16.0`, remove the development archive and
rerun the consumer suites before merging/releasing HeyHubs.

Regression coverage includes DM switching, quota failure/retry, outbox reload and
cancellation, public token exclusion, historical certificate validation and live
channel eviction. Run both applications' unit/coverage, Workers, builds and P2P/DO
browser suites against the same packed core artifact.

## Validation (2026-09-22)

- Peerly: 940 unit tests, 89 Workers tests, 62 P2P browser tests and 5 DO browser tests passed.
- HeyHubs: 234 unit tests plus 4 version-script tests, 73 Workers tests, 18 P2P browser tests and 4 DO browser tests passed.
- Both: coverage thresholds, lint/type checks, production builds, Worker generated-type checks and production/preview dry runs passed; production dependency audits reported zero vulnerabilities.
- Peerly preview build, CSP positive/negative controls and service-worker offline boot passed.
- HeyHubs fresh install used the committed archive. Its production bundle guard excludes test key material; the fixture identity issuer is enabled only in the local E2E dev server.

The final identity cache regression also covers two simultaneous issuance calls
after switching accounts, preventing reuse of the previous account's certificate.
