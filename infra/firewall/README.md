# Provider and host firewall allowlist

Expose only TCP 22 from the administrator VPN/CIDR, TCP 80/443, UDP/TCP 3478,
TCP 5349, and UDP 49152–65535. Keep relay ports 8090/8091 and nginx's loopback
8443 listener private. Apply the same rules at both the cloud-provider firewall
and nftables/UFW, then verify from an unrelated network. Do not run the commands
until the administrator CIDR and public interface have been substituted.

Before reloading sshd, run `sshd -t`, retain an existing root session, and prove
key login in a second session. Only then enable the drop-in in `infra/ssh/`.

