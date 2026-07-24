# Production relay, TURN, and rendezvous rollout

This describes the current production path (`COORDINATION_BACKEND=legacy-relay`).
The Durable Objects control plane's own cutover/rollout steps live in
[DURABLE_OBJECTS_ARCHITECTURE.md](./DURABLE_OBJECTS_ARCHITECTURE.md) (Phase 5)
instead of here.

Deploy two independent relay/TURN stacks (different providers or regions) and
set `VITE_RELAY_HOSTS` plus Worker `TURN_URLS` to both. Each relay gets its own
hostname-bound entry in `RELAY_TICKET_SECRETS`; both Workers mint against the
matching audience. The client rotates relay hosts after disconnect and browsers
receive the complete TURN transport/region list.

Set Worker secrets interactively: `RELAY_TICKET_SECRET`,
`RELAY_TICKET_AUDIENCES`, `TURN_AUTH_SECRET`, and `RENDEZVOUS_SECRET`. Never place
their values in git or shell history. Configure `RENDEZVOUS_RATE_LIMITER` as in
`wrangler.jsonc`. Match the coturn REST secret to `TURN_AUTH_SECRET`, with
credentials expiring in at most ten minutes.

Roll out in this order: secondary stack, Worker credentials, clients, primary
stack. Validate `/healthz`, `/readyz`, `/metrics`, relay host/audience rejection,
expired/replayed tickets, TURN allocation expiry and quotas, then remove every
old static browser credential. Rotate relay/TURN secrets once more after the
migration. Securely delete or expire nginx/coturn logs that captured old query
tokens; current nginx logs `$uri`, never `$request_uri`.

Run `RELAY_LOAD_CLIENTS=50`, then 100 and 500 against staging. Repeat with
reconnect churn, process restarts, one region unavailable, TURN disabled, slow
consumers, directory fanout, and subscription churn. Record CPU, memory, event
loop lag, drops, reconnect time, mobile dropped frames, and battery impact.

Finally commission an independent test of forged OIDC/device attestations,
replay and cross-app/audience attacks, invitation interception, relay-ticket
theft, topic authorization, reconnect/IP rate-limit bypass, TURN exhaustion,
WebSocket parsing, and backpressure. This repository supplies test tooling and
controls; it cannot substitute for independent production access and review.
