# Matchmaking: deferred architecture decision

Status: **not implemented and intentionally undecided**.

Peerly's invite-only workspaces remain fully peer-to-peer. Automated matching
of strangers is a separate future product decision, not part of the storage,
sync, sensitive-media, or redesign work.

Before selecting an implementation, compare:

- pure P2P rendezvous for a controlled friends-of-friends experiment;
- user-hosted or community-hosted coordinators;
- federated matchmakers with portable identity and block data;
- privacy-preserving queues or capability-ticket schemes;
- a minimal product-operated authority;
- discovery through existing communities instead of automatic matching.

The decision must explicitly evaluate moderation authority, Sybil resistance,
preference and IP metadata, block enforcement, sparse-pool liveness, relay
dependence, operational cost, and safe failure behavior.

Do not add a provider-specific service, queue, admission ticket, or stranger
room handshake until that discussion produces a separate approved design.
