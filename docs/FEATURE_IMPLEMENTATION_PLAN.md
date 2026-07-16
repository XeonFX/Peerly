# Storage, progressive sync, sensitive media, and redesign

Status: active implementation plan (matchmaking excluded)

This plan reflects the codebase as audited on 2026-07-16. It replaces the
architecture-neutral draft with work mapped to Peerly's current React,
Trystero, localStorage, and IndexedDB implementation.

## Already present before this pass

- Content-addressed files and integrity verification.
- IndexedDB-backed file cache with bounded in-memory buffers.
- History sync that transfers metadata separately from file bodies.
- Initial workspace usage estimator and local clear action.
- Thumbnail fields in file/history protocol types and safe data-URL validation.
- Initial lazy NSFWJS helper and unit tests.
- Initial on-demand/automatic sync preference UI.

The audit found that thumbnails, NSFW classification, and the sync preference
were not yet wired into the send/receive/history UI. History still fetched all
missing file bodies automatically.

## Delivery phases

### 1. Browser storage pressure and workspace accounting

- [x] Show `navigator.storage.estimate()` usage, approximate quota, and
  approximate available space when supported.
- [x] Show whether persistent storage was granted and offer a request action.
- [x] Classify notice/warning/critical pressure using both ratio and remaining
  bytes; use hysteresis and deduplicated notifications.
- [x] Pause automatic/background original downloads under warning/critical
  pressure while keeping text/history sync available.
- [x] Report local cached bytes separately from logical shared file bytes.
- [x] Split **Free local space** (file bodies only) from **Clear local history**.

### 2. Progressive and on-demand sync

- [x] Default to metadata + thumbnails; do not fetch original bodies on join.
- [x] Make missing images/files visibly downloadable rather than dead links.
- [x] Add an explicit per-file request action with availability/progress states.
- [x] Surface real history phases and channel counts; do not fake byte totals
  the current history protocol does not provide.
- [x] Automatic mode may fetch originals only when storage pressure permits.

A true byte-accurate join manifest and resumable range transfer require a new
wire protocol. They remain follow-up protocol work rather than being simulated
in the UI.

### 3. Sensitive-media screening

- [x] Keep TensorFlow/NSFWJS out of the initial route using a dynamic,
  MobileNetV2-only import and a single global inference queue.
- [x] Generate and send thumbnails for raster images and common video files.
- [x] Screen shared image/video previews locally and hide flagged media until
  the receiver deliberately reveals it.
- [x] Sample visible remote video streams at a throttled interval; pause when
  the page/video is hidden and never retain sampled frames.
- [x] Fail open for invite-only workspaces when classification is unavailable.

This is a receiver-side privacy/UX filter. A modified P2P client can bypass its
outbound checks; it is not a global moderation authority.

### 4. Visual redesign

- [x] Use the supplied Peerly artwork on the sign-in/workspace picker and as
  the palette source.
- [x] Move the palette from emerald/cyan to a modern violet/blue/teal system
  with matching light and dark themes, neutral surfaces, and accessible contrast.
- [x] Redesign storage cards, warnings, sync states, workspace rows, sidebars,
  file cards, and sensitive-media overlays.
- [x] Verify desktop and mobile layouts in the running app.

### 5. Cleanup semantics

- [x] Freeing local space deletes unshared cached bodies only when no other
  local workspace references them; it retains history and access.
- [x] Clearing local history is separately confirmed and retains workspace
  access.
- [x] Quota errors leave downloads retryable and never mark missing bytes as
  cached.

“Clear for everyone” is not part of this pass. Peerly currently has no signed,
monotonic workspace-reset epoch in its protocol. Shipping a broadcast delete
without that primitive would let a long-offline peer resurrect cleared data.
That action needs a separate protocol/security design before implementation.

### 6. Appearance and connectivity readiness

- [x] Add a first-class light/dark theme using the Peerly violet, blue, and teal palette.
- [x] Default to the operating-system theme, then persist an explicit device preference.
- [x] Expose the theme toggle before sign-in, in the workspace header, and in settings.
- [x] Run a local WebRTC data-channel self-test to detect missing/disabled browser P2P support.
- [x] Distinguish local readiness from a real, verified peer path and a TURN-needed failure.

#### Relay selection (decision pending)

User-editable signaling relays are intentionally not implemented yet. They are useful as an
advanced resilience/privacy control, but two members who choose disjoint relay sets cannot discover
one another. A safe design should keep a recommended fallback set, validate and cap `wss://` URLs,
show relay health, and share a workspace relay profile through the signed invite rather than silently
changing it on only one device.

## Matchmaking boundary

No matchmaking implementation, provider selection, queue schema, admission
ticket, or server dependency is included. `docs/MATCHMAKING.md` records the
open decision space only; alternatives will be discussed before a direction is
chosen.

## Verification

- Unit tests for storage thresholds/accounting, sync preferences, MIME/video
  handling, thumbnails, and NSFW policy.
- Existing Vitest suite, lint, TypeScript build, Vite production build, and
  bundle guard.
- Browser verification for light/dark theme switching, P2P readiness, desktop
  and mobile layouts, storage warnings, missing files, sync progress, and
  sensitive-video states where reproducible.
