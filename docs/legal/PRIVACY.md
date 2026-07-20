# Privacy Policy

_Last updated: 2026-07-20_

> This is the English reference copy. The authoritative, localized text is the
> in-app page at `/privacy` (rendered from `src/legal/legalContent.ts`). Edit
> controller/contact details in `src/legal/legalMeta.ts`.

Peerly is a peer-to-peer (P2P) team collaboration tool: messages, files, and
calls travel directly between browsers over WebRTC. We run no server that stores
your workspace content. Even so, using Peerly involves processing some personal
data (such as IP addresses and the email addresses of invited people). This
document explains it.

## 1. Data controller

The controller is **Krystian Pawłow** (an individual operating the Peerly
service), Poland. Privacy contact: **privacy@peerly.cc**.

## 2. Our approach: no application server

Peerly has no backend storing your messages, files, or workspace history. That
data lives locally in your browser and is sent directly to invited participants.
To establish connections we use public signaling relays (Nostr / WebSocket
relay) and, when needed, a TURN server.

## 3. What data is processed

- **Sign-in (OIDC)** — you sign in through a third-party provider (Google,
  Microsoft, Apple, or another OIDC provider). The ID token is verified entirely
  in your browser; from it we read your email and name and store them locally.
- **Allow-list (invitations)** — the workspace creator signs a list of email
  addresses permitted to join. This list is sent P2P to participants so they can
  verify one another, meaning invited people's email addresses are visible to
  other members of the workspace.
- **IP address** — connecting to another participant means your browsers
  exchange IP addresses; they are also visible to relay/TURN operators.
- **Content** — messages, files, video-call audio/video, name, and avatar go
  directly to workspace participants.
- **On-device data** — history and files (IndexedDB), preferences, a device
  cryptographic key, remembered workspaces, and consents. Optional pairing
  syncs selected data directly between mutually approved devices while both
  are online; login sessions, identity tokens, and private keys are not copied.

We run no analytics, tracking pixels, or advertising. We do not sell data.

## 4. Legal bases (GDPR Art. 6)

Performance of the service (Art. 6(1)(b)); legitimate interests — security and
operation of the P2P network and access control (Art. 6(1)(f)); consent —
camera/microphone, accepting the Terms (Art. 6(1)(a)).

## 5. Who can see your data

Other participants (name, avatar, messages, files, IP; and the invited-email
allow-list); relay and TURN operators (metadata, IP); the sign-in provider; the
static-hosting provider (standard request logs).

## 6. Third parties

OIDC identity providers; public Nostr / WebSocket relays; an optional TURN
server; static hosting (e.g. Cloudflare). Some may process data outside the EEA
under GDPR transfer mechanisms.

## 7. Retention and deletion

We hold no central copy of your content. You can delete local data at any time
(sign out, leave/clear a workspace, clear site data). Copies you sent to others
remain on their devices.

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

P2P connections are encrypted (DTLS/SRTP), access is cryptographically
restricted to invited addresses, and peer identity is verified. No system is
100% secure.

## 12. Changes

We may update this Policy; we will signal material changes and ask you to accept
again.

## 13. Contact

Privacy: **privacy@peerly.cc** · Abuse reports: **abuse@peerly.cc**
