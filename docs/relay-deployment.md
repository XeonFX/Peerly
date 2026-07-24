# Relay and TURN deployment hardening

This covers the self-hosted `ws-relay` + coturn stack, which is still what
production (`COORDINATION_BACKEND=legacy-relay`) runs. The newer Cloudflare
Durable Objects control plane (preview only today) replaces this stack when
selected — see [DURABLE_OBJECTS_ARCHITECTURE.md](./DURABLE_OBJECTS_ARCHITECTURE.md).

The browser never receives a long-lived relay or TURN secret. `/api/network/credentials` verifies the configured OIDC provider, requires the token nonce to equal the browser device key, verifies a fresh signature from that key, then mints a host-bound relay ticket and coturn REST credentials valid for at most ten minutes.

## Worker secrets

Set `RELAY_TICKET_SECRET`, comma-separated `RELAY_TICKET_AUDIENCES`,
`TURN_AUTH_SECRET`, `TURN_URLS`, and `RENDEZVOUS_SECRET`. Each relay hostname
receives a distinct audience-bound ticket. Mirror the app's provider
configuration in the Worker. For a generic provider, set `OIDC_JWKS_URL` when
its keys are not at `<issuer>/.well-known/jwks.json`.

## Relay process

Run `server/relay-prod.mjs` with `RELAY_TICKET_SECRETS="relay.example.com=<same relay secret>"`. It binds `127.0.0.1` only. Expose the health listener only to local monitoring.

The separate loopback health listener exposes:

- `/healthz` and `/readyz` — JSON readiness for the WebSocket relay.
- `/metrics` — Prometheus text metrics for relay connections, traffic,
  drops/rate limits, subscriptions, coordinator presence/seek/room/channel
  state, match proposals, and channel fanout.

Alert on sustained increases in `peerly_relay_rejectedTotal`,
`peerly_relay_rateLimitedTotal`, `peerly_relay_droppedTotal`, and
`peerly_coordinator_rateLimitedTotal`, as well as unexpected growth in active
topics, subscriptions, channels, or pending matches.

Recommended systemd restrictions, after staging compatibility tests:

```ini
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=512M
TasksMax=256
UMask=0077
```

## Nginx

Do not log WebSocket query strings because they contain short-lived bearer tickets. Log `$uri`, not `$request` or `$request_uri`:

```nginx
log_format relay_no_query '$remote_addr - $host [$time_local] '
                          '"$request_method $uri $server_protocol" $status $body_bytes_sent';

server {
    access_log /var/log/nginx/relay.access.log relay_no_query;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Rotate or redact historical logs that contained old `?token=` values. Keep provider/firewall rules closed to port 8090 and expose only TLS through nginx. Configure coturn with `use-auth-secret`, the same `TURN_AUTH_SECRET`, allocation/user/total quotas, stale nonces, and bandwidth limits.

The credential worker caches each provider's last-good JWKS for five minutes
and may use it for at most 24 hours during a transient provider outage. A JWT
whose `kid` is not in the fresh cache forces an immediate refresh so key
rotation is not delayed.
