# PR #92: security fixes and preview rollout

The Durable Objects deployment for this branch is **https://preview.peerly.cc**,
configured as a custom domain of `peerly-preview` in `wrangler.preview.jsonc`.
`npm run deploy:preview` builds the frontend with both DO signaling and DO
content enabled and deploys that Worker. Preview assets are built into
`dist-preview/`; production uses `dist/`. Even a preview dry-run cannot
overwrite the next production deploy's assets. Branch aliases created by the
production Worker's version uploads still use the legacy backend.

A plain `npm run build` now selects P2P content, matching production
`wrangler.jsonc`. Runtime Worker vars do not configure a Vite build. Both
profiles are covered by configuration tests; the DO browser suite is now part
of CI and explicitly enables both frontend DO flags.

## Server-visible values and encryption keys

Content authorization and signaling send a SHA-256 routing capability derived
in the browser with the `peerly-routing-v2` domain and a distinct channel
context. The encryption secret remains in the browser. A server-visible
capability cannot be substituted as the AES-GCM content key.

Friend invitations, invitation responses, workspace invitations, and DM rings
also use encrypted lobby envelopes. Each browser advertises an ephemeral
P-256 ECDH public key inside its signed, OIDC-bound presence. Recipients' keys
are admitted only after verifying that presence and its rendezvous identity.
AES-GCM envelopes are bound to the event and both public keys, with independent
random IVs. Multiple verified devices receive separately encrypted copies.
There is no plaintext fallback for older clients. Presence remains public to
the authenticated lobby; the invitation's workspace/DM root is not.

## Workspace authority

New creator-signed policies include the workspace's derived capability in the
signed payload. Replaying a policy into another workspace fails verification.
The server derives a v2 channel address from both the capability and the
creator key, so changing the signer addresses a different channel rather than
claiming the existing one. Each channel also pins its authority owner in
SQLite and rejects changes to that owner, regardless of the revision number.
Future-dated policies are rejected; legitimate revisions must remain monotonic.

Only the original creator device may upgrade a legacy unscoped membership
list. Its updated invite can then be shared with members; the peer handshake
can also distribute the newer signed list. A member cannot synthesize a
replacement policy when the creator is unavailable.

## Compatibility and existing preview data

This is a protocol change, not a transparent history migration:

- Reload all preview tabs/devices together. Old clients cannot exchange the
  new encrypted lobby invitations, and old content authorization is rejected.
- Existing workspaces need an updated scoped policy from their original
  creator. Newly created workspaces get one immediately.
- V2 content routes address new DO instances. Existing DO history is not
  deleted, but is not automatically replayed into the new routes. Existing
  browser-local history is retained. Export any important preview history
  before deployment; test the change with a newly created workspace and DM.
- Old releases sent root secrets to the server. This patch cannot revoke
  knowledge already obtained by a server or retroactively protect old
  ciphertext. Use a new workspace secret (a newly created workspace/invite)
  and a freshly established DM secret when requiring confidentiality from
  the previous server-visible roots.
- This does not cut production over to Durable Objects or alter its bindings.

## Regression coverage

Tests cover an unrelated signer attempting to replace a workspace owner,
cross-workspace policy replay, poisoned future revisions, legitimate removal,
legacy-policy upgrade, distinct deployment profiles, and failure to decrypt
content using the server-visible capabilities. Lobby tests cover recipient
isolation, multiple devices, tampering, plaintext rejection, and missing keys.
Browser tests verify the actual workspace secret and plaintext chat do not
appear in outbound WebSocket frames, alongside offline history, DM delivery,
reactions, file transfer, and device pairing.

Real Google OAuth and silent credential renewal still require a real account;
the local browser suite uses its existing test OIDC issuer.
