# Shared relay and TURN on one IPv4 address

The production VPS serves these names from one address:

- `relay.peerly.cc` and `relay.heyhubs.app`: HTTPS/WSS signaling
- `turn.peerly.cc` and `turn.heyhubs.app`: TURN

Strict networks often allow only TLS on TCP 443. nginx therefore owns public
TCP 443 and uses TLS SNI prereading (without decrypting) to route `turn.*` to
coturn TLS on loopback 5349 and everything else to the HTTPS/WSS listener on
loopback 8443.

Required Debian module:

```bash
sudo apt-get install libnginx-mod-stream
```

The top-level nginx configuration contains:

```nginx
stream {
    map $ssl_preread_server_name $tls_backend {
        turn.peerly.cc    127.0.0.1:5349;
        turn.heyhubs.app  127.0.0.1:5349;
        default           127.0.0.1:8443;
    }

    server {
        listen 443;
        listen [::]:443;
        proxy_pass $tls_backend;
        ssl_preread on;
        proxy_connect_timeout 10s;
        proxy_timeout 3600s;
    }
}
```

The HTTP relay virtual host listens on `127.0.0.1:8443 ssl`; port 80 remains
public for redirects and ACME HTTP challenges. coturn retains UDP/TCP 3478 and
TLS 5349. Its certificate must cover all four DNS names. The firewall permits:

- TCP 80 and 443
- UDP/TCP 3478
- TCP 5349
- UDP 49152–65535 for relay allocations

The browser configuration includes the full fallback ladder:

```text
turn:turn.example:3478?transport=udp
turn:turn.example:3478?transport=tcp
turns:turn.example:5349?transport=tcp
turns:turn.example:443?transport=tcp
```

`@peerly/core` adds this ladder automatically for conventional TURN URLs.
Validate TLS 443 with a browser `RTCPeerConnection` using
`iceTransportPolicy: "relay"`; success requires at least one candidate whose
type is `relay`. A TLS handshake alone proves SNI routing and certificates, but
does not prove TURN authentication or allocation.

On the current VPS, the pre-SNI nginx files are backed up under
`/var/backups/codex-turn-sni-20260720T1415Z`. Certificate renewal reloads nginx
and restarts coturn so both processes pick up the renewed shared certificate.
