# Privacy Policy

_Last updated: 2026-07-29_

> This is the English reference copy. The authoritative, localized text is the
> in-app page at `/privacy` (rendered from `src/legal/legalContent.ts`). Edit
> controller/contact details in `src/legal/legalMeta.ts`.

Peerly is a hybrid team collaboration tool. Messages and reactions are encrypted
on your device and delivered and briefly retained by our infrastructure, while
files and calls travel directly between browsers over WebRTC (P2P). Using
Peerly also involves processing some personal data, such as IP addresses and
the email addresses of invited people. This document explains it.

## 1. Data controller

The controller is **Krystian Pawłow** (an individual operating the Peerly
service), Poland. Privacy contact: **privacy@peerly.cc**.

## 2. Our approach: encrypted durability and P2P

Messages, reactions, and channel definitions are encrypted in your browser
before transmission. Our Cloudflare Durable Objects infrastructure stores only
encrypted event envelopes and does not receive the workspace or conversation
key needed to read their content. Files and call audio/video are not stored in
Durable Objects: they remain local and transfer P2P. P2P can also be selected
as an alternative message transport at deployment level.

## 3. What data is processed

- **Sign-in (OIDC)** — you sign in through a third-party provider (Google,
  Microsoft, Apple, or another OIDC provider). The ID token is sent to our
  Worker for verification. Its email is used to derive a pseudonymous member
  identifier; the token and raw email are not stored in a Durable Object. Your
  name and email are also stored locally.
- **Allow-list (invitations)** — the workspace creator signs a list of email
  addresses permitted to join, which members can see. The Worker processes the
  list during authorization, verifies its signature, and gives the Durable
  Object only pseudonymous member identifiers rather than raw addresses.
- **Lobby and friend invitations** — an authenticated, non-persistent Durable
  Object channel forwards signed presence, invitation, and DM-notification
  data. This can include the invitation sender's email, but it is not stored as
  server history or a mailbox.
- **IP address** — connecting to another participant means your browsers
  exchange IP addresses; they are also visible to relay/TURN operators.
- **Content and metadata** — Durable Objects receive encrypted messages,
  reactions, and channel definitions plus infrastructure-visible pseudonymous
  user/device identifiers, event type, and time. Names and avatars are encrypted
  in transit. Files and call audio/video go directly to participants P2P.
- **On-device data** — history and files (IndexedDB), preferences, a device
  cryptographic key, remembered workspaces, and consents. Optional pairing
  syncs selected data directly between mutually approved devices while both
  are online; login sessions, identity tokens, and private keys are not copied.

We run no analytics, tracking pixels, or advertising. We do not sell data.

## 4. Legal bases (GDPR Art. 6)

Performance of the service, including encrypted event delivery and P2P
connections (Art. 6(1)(b)); legitimate interests — infrastructure security,
reliable delivery, and access control (Art. 6(1)(f)); consent —
camera/microphone and accepting the Terms (Art. 6(1)(a)).

## 5. Who can see your data

Other participants (name, avatar, messages, files, IP; and the invited-email
allow-list); Cloudflare and the Peerly operator (encrypted envelopes,
pseudonymous identifiers, event type/time, transient lobby/invitation data, and
standard request logs, without the encrypted-content key); relay and TURN
operators (connection metadata and IP); and the sign-in provider.

## 6. Third parties

OIDC identity providers; public Nostr / WebSocket relays; an optional TURN
server; and Cloudflare hosting, Workers, and Durable Objects. Some may process
data outside the EEA under GDPR transfer mechanisms.

## 7. Retention and deletion

Encrypted events are retained for at most 30 days and are capped at the latest
1,000 events per workspace or conversation; older events are removed
automatically. You can delete local data at any time (sign out, leave/clear a
workspace, clear site data). Copies sent to others remain on their devices.
Contact us below about a server-held copy.

## 8. Your rights

Access, rectification, erasure, restriction, portability, and objection — many
exercised yourself in the browser; otherwise email **privacy@peerly.cc**. You
may also complain to the supervisory authority (UODO, Poland).

## 9. Cookies and local storage

No cookies for tracking or advertising; only essential local storage. External
sign-in may set the provider's own cookies.

## 10. Age

Peerly is intended for people aged at least **16**.

## 11. Security

Durable event content is encrypted client-side (AES-GCM), P2P connections are
encrypted (DTLS/SRTP), access is restricted to the signed membership list, and
device and author identity is verified cryptographically. No system is 100%
secure.

## 12. Changes

We may update this Policy; we will signal material changes and ask you to accept
again.

## 13. Contact

Privacy: **privacy@peerly.cc** · Abuse reports: **abuse@peerly.cc**
