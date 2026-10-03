# Two tabs of one browser

A workspace can be open in several tabs of one browser profile at once. Each tab is its own peer; together they are one
person on one device.

## Why a second tab used to be refused

Every tab of a profile reads the same device key from IndexedDB (`DeviceIdentity`), and the sign-in's ID token is bound
to that key (its `nonce` is the device key id). The handshake's proof of possession signed a transcript naming the
signer's and the verifier's device keys. With one key on both sides those names are equal, so a proof could pass for
the other side's, and the handshake refused any peer that presented this device's own key ("the peer presents this
device's own key"). The second tab therefore never connected, and the first showed a connection error.

## Tab keys

`@peerly/core` `tabSession.ts`. Each tab generates a P-256 tab key in memory when it starts: non-extractable, never
stored, gone when the page goes (a reload is a new tab). The device key signs a tab certificate for it:

```
["peerly-tab-session-v1", context, deviceKeyId, tabKeyId, issuedAt, expiresAt]
```

`context` is the workspace (`workspace:<creatorKeyId>`). A certificate lives an hour; a tab re-issues its own a quarter
of an hour before that, so a tab that slept for hours renews when it reconnects. The certificate carries no peer input:
a tab issues it before talking to anyone.

## The handshake (protocol v3)

`peerIdentityHandshake.ts` `proveTabKeys`, called by the workspace handshake (`src/collab/identityHandshake.ts`).

1. Each side sends its attestation (ID token, device key id, allow-list) and its tab certificate. A peer without a
   certificate runs an older Peerly and is told to reload; nothing is signed for it.
2. ID token and allow-list are checked as before. The token's nonce binds it to the device key.
3. The peer's tab certificate must be signed by that device key, for this workspace, and be current (5 minutes of clock
   skew allowed). An expired one is refused as a stale tab; a forged, altered, other-workspace or over-long one is
   refused as unsigned.
4. Their tab key must not be ours. If their device key is ours, the peer is another tab of this browser only if a tab
   here answers for its tab key (below); otherwise it is refused.
5. Fresh challenges, then each side signs
   `["peerly-peer-handshake-v3", context, signer device, signer tab, verifier device, verifier tab, verifier challenge, signer challenge]`
   with its tab key. The other side verifies against the certified tab key.

What this keeps:

- The chain ID token → device key → tab certificate → tab key → live proof binds the connection to the signed-in
  device, as the device key alone did.
- Naming the verifier's tab key in the proof means a proof made for one tab is no good at another, including the other
  tab of the same browser. Relaying a proof between members, or between a member and a sibling tab, fails.
- A captured certificate is useless without the tab's private key, which never leaves WebCrypto or the page.
- The device key now signs only the tab certificate, never anything a peer sent. Previously it signed each handshake
  transcript; the creator's device key, which also signs the member list, signs less than before.
- It is still not bound to the WebRTC transport (no DTLS fingerprint): a member relaying an entire handshake in real
  time sits in the middle of that channel, as before.

## Which tabs are siblings

`src/collab/browserTabs.ts`. Tabs talk over a `BroadcastChannel`; only same-origin pages of this profile can post on
it, which is also all that can use the device key. When a peer presents this device's key, the tab asks "who holds tab
key X?" and waits up to 1.5 s for another tab to answer. Each tab holds a Web Lock `peerly-tab:<id>` for its lifetime,
which the browser releases when the tab closes, crashes or is discarded; an answer from a tab whose lock is gone is a
stale tab and does not count. Without BroadcastChannel no tab is a sibling, which is the old one-tab behaviour.

`useWorkspaceAuth` records which verified peers are siblings (`isSiblingTab(peerId)`), before the room reports them
joined.

## Behaviour between sibling tabs

- They sync messages, history, channels and files like any peers. Your own messages from another tab are yours (by
  verified user id), never unread.
- They are not listed as members (they are you), and never part of a call: media is sent only to non-sibling peers and
  a sibling's stream is ignored.
- Attention happens once per browser. A DM chime or notification, an incoming-call ringtone and friend/workspace invite
  notifications go through `browserTabs().claim(key)`: one tab wins a short Web Lock and tells the others, which stay
  quiet (also when they receive the same event later). A visible tab is preferred for a ringtone. Answering or
  declining a call in one tab settles it in the others.
- Copy: when another tab joins, both show "This workspace is also open in another tab of this browser…"; when one
  closes, the others say "Your other tab closed…" (or "One of your other tabs closed…"). Your own row reads
  "you · 2 tabs". A tab that drops and returns within 6 s (a network blip, a reload) is a reconnect and says nothing.

## Not covered

- Tabs in different browser profiles or private windows have different device keys: they are separate devices, as
  before.
- The presence lobby and global friend DMs use their own handshakes, which this change does not touch; only their
  OS notifications are de-duplicated across tabs.
