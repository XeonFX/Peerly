# Engineering audit closeout — 2026-07-23

This document reconciles the 2026-07-21 Peerly/HeyHubs audit against the
repository state after the audit-hardening work. “Complete” means the
repository contains the control and its automated evidence. It does not claim
that an infrastructure template has been applied to a host or that an
independent test has occurred.

## Peerly application controls

| Audit finding | Status | Repository evidence |
| --- | --- | --- |
| Global unprotected WebRTC lobby | Complete | Presence and friend routing use the authenticated relay coordinator through `useRelayChannel`; relay credentials are OIDC/device-bound and short-lived. |
| Friend-recipient impersonation and deterministic email discovery | Complete | `src/collab/friendInvite.ts` v4 signs an opaque Worker-issued rendezvous capability, rejects the legacy hash envelope, binds the sender email to an OIDC/device attestation, expires messages, and rejects target/cross-invite tampering. `src/hooks/usePresenceLobby.ts` accepts only the local authenticated capability. |
| Static relay/TURN browser credentials | Complete in code | `packages/core/src/runtimeCredentials.ts` obtains audience-bound relay tickets and TURN REST credentials at runtime. Bundle guards reject retired static credential variables. |
| Relay abuse controls | Complete in code | `server/boundedRelay.mjs`, `server/coordination.mjs`, and their tests enforce payload, topic, subscription, directory, connection, and rate limits with bounded metrics. |
| Relay availability/observability | Complete in code | `server/relay-prod.mjs` supplies `/healthz`, `/readyz`, and `/metrics`; Prometheus alerts and hardened deployment templates live under `infra/`. |
| Single endpoint handling | Client complete; infrastructure pending | Runtime credentials accept multiple relay/TURN audiences and client relay selection rotates across configured endpoints. A genuinely independent second deployed provider/region is an operations item. |
| Cache, bundle, and route performance | Complete | `public/_headers` gives immutable hashed assets and revalidated HTML; routes are lazy; build enforces credential and entry-bundle budgets. |
| CI and supply chain | Complete where GitHub exposes the feature | Blocking lint, unit, coverage, build, CSP, browser/a11y, production audit, Worker validation, mutation, secret scan, CodeQL, and dependency review workflows use pinned action SHAs. |
| Accessibility defects | Complete for audited defects | Semantic/focus-managed dialogs, status announcements, reduced motion, corrected landmarks/headings, and automated axe/keyboard/viewport tests are present. |
| Large stateful hooks | Partially complete | Protocol types, mappers, presence indexing, storage, relay, coordinator, and identity verification are extracted and tested. `useCollab` and `usePresenceLobby` remain larger than the long-term maintainability target; further splitting is not a production security prerequisite. |

## Production evidence checked on 2026-07-23

- `https://peerly.cc/login` returns revalidated HTML, HSTS, restrictive CSP,
  COOP, Permissions Policy, and `nosniff`.
- Unauthenticated `POST /api/network/credentials` returns `401`.
- The rendezvous API is routed through the Worker and rejects malformed input.
- The production relay rejects a retired static token.
- The production relay currently returns HTTP `426` rather than the repository
  health/readiness/metrics handlers. Applying the supplied VPS service/nginx
  deployment is therefore still an operational rollout requirement.

## Work that cannot be completed by a repository PR

- Apply the nginx, coturn, systemd, SSH, and firewall templates to every live
  relay/TURN host; rotate the old shared credentials; and expire or securely
  remove logs that captured query tokens.
- Deploy and exercise a second relay/TURN stack in a different failure domain.
- Run controlled 50/100/500-client staging load, reconnect-storm, slow-consumer,
  relay-restart, TURN-outage, and allocation-exhaustion tests while collecting
  host metrics.
- Measure battery, temperature, dropped frames, and field Web Vitals on real
  mobile devices. The local Chrome performance-trace MCP was unavailable for
  this closeout; deterministic bundle and browser gates still run in CI.
- Commission the independent penetration test described in
  `docs/production-rollout.md`.

These are explicit deployment or independent-assurance obligations, not hidden
unfinished application changes.
