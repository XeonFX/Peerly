# Peerly views and functions

How each screen works, how URL routing maps to UI state, and which modules
implement the main capabilities. Implementation lives mainly in
[`src/App.tsx`](../src/App.tsx), [`src/routing.ts`](../src/routing.ts),
[`src/hooks/useAppRouting.ts`](../src/hooks/useAppRouting.ts),
[`src/components/JoinScreen.tsx`](../src/components/JoinScreen.tsx),
[`src/components/Workspace.tsx`](../src/components/Workspace.tsx), and
[`src/hooks/useCollab.ts`](../src/hooks/useCollab.ts).

**Live app:** [peerly.cc](https://peerly.cc)

## Mental model

Peerly is **invite-only team collaboration**, not a public lobby.

| Concept | Role |
|---------|------|
| **Workspace** | One encrypted Trystero room. The random `workspaceId` is both the room address and the room password. |
| **Invite** | Base64 payload in the URL **hash** (`#invite=…`): workspace id, name, creator device key id, creator-signed allow-list. Never sent to the static host in HTTP logs. |
| **Identity** | OIDC ID token (Google / Microsoft / Apple / generic) verified in-browser via JWKS; email must be on the allow-list. Bound to a non-extractable device key. |
| **Session** | Active workspace + identity credentials in storage. Leaving a workspace clears the active workspace but can keep you signed in for the picker. |
| **Channels / DMs** | Logical scopes **inside** one workspace room (not separate WebRTC rooms). History is partitioned by `channelId`. |

```mermaid
flowchart TB
  subgraph picker [No active workspace]
    SignIn[OIDC sign-in]
    Create[/create]
    Join[/join + hash invite]
    Stored[Remembered workspaces]
  end
  subgraph ws [Active workspace]
    Sidebar[Sidebar]
    Channel[Channel / DM chat]
    Files[Files panel]
    Profile[Profile]
    Settings[Settings]
  end
  SignIn --> Create
  SignIn --> Join
  SignIn --> Stored
  Create --> ws
  Join --> ws
  Stored --> ws
  Sidebar --> Channel
  Channel --> Files
```

Signaling (Nostr by default, or `ws-relay` / Supabase) is used only so peers
**discover** each other. Messages, files, and call media go peer-to-peer.
There is no app server archive of chat or files.

---

## Route map

| Path | Screen | View / tab | Requires active workspace |
|------|--------|------------|---------------------------|
| `/`, `/create` | Picker | Create workspace | No |
| `/join` | Picker | Join (invite or stored) | No |
| `/workspace` | Workspace | Default channel (`general`) | Yes |
| `/workspace/channel/:channelId` | Workspace | Channel or DM | Yes |
| `/workspace/channel/:channelId?files=1` | Workspace | Same + files side panel open | Yes |
| `/workspace/profile` | Workspace | Your profile card | Yes |
| `/workspace/settings` | Workspace | Workspace settings | Yes |

Types: [`src/routing.ts`](../src/routing.ts) (`PickerRoute`, `WorkspaceRoute`,
`AppRoute`).

### Routing rules

- **Hash invite preserved** on picker navigations (`pathWithHash` /
  `preserveHash`) so `#invite=…` is not stripped when switching Create/Join.
- **Workspace URLs without a session** fall back to the picker (create).
- **Session without a workspace route** upgrades to the default channel view.
- **Invite in hash on first load** opens the join tab automatically
  (`resolveInitialRoute`).
- Refresh keeps the path; channel id and `?files=1` are first-class URL state.

Wiring: [`useAppRouting`](../src/hooks/useAppRouting.ts).

---

## App shell (`App`)

[`App.tsx`](../src/App.tsx) is a thin gate:

1. **Hydrate** session (migrate legacy, optional E2E auth bypass, avatar).
2. If **no session** → `JoinScreen` (picker).
3. If **session** → `Workspace` with auth hooks and collab provider.

| Function / hook | Role |
|-----------------|------|
| `useAppRouting(inWorkspace, ready)` | Path ↔ route state; enter/leave workspace |
| `useWorkspaceAuth(session, onAllowList)` | Device identity, peer handshake, message/reaction signing, allow-list updates from peers |
| `clearActiveWorkspace` + `leaveToPicker` | Leave workspace, stay signed in, land on picker |
| `rememberWorkspace` / `snapshotWorkspace` | Persist workspace access for the next visit |

---

## Picker: Join screen

Path: `/create` or `/join` · Component: [`JoinScreen`](../src/components/JoinScreen.tsx)

Shown whenever there is no **active** workspace session. Identity credentials
can still be present (signed in, between workspaces).

### Create tab (`/create`)

| Step | What happens |
|------|----------------|
| Sign in | OIDC via [`IdentityLoginButtons`](../src/components/IdentityLoginButtons.tsx) / provider modules under `collab/` |
| Name workspace + optional guest emails | Creator’s email is always on the list |
| Submit | `WorkspaceAuthManager.createInvite` → signed allow-list + new `workspaceId` |
| Result | Session saved, workspace remembered, invite link generated (`encodeInviteLink`), enter workspace |

### Join tab (`/join`)

| Source | What happens |
|--------|----------------|
| `#invite=…` in URL | `decodeInviteFromHash` → join form; tab forced to join |
| Paste / open link | Same verification path |
| Stored workspace card | `handleOpenStored` re-verifies allow-list signature, then joins without the link |

Join always:

1. `verifyInviteAllowList` (creator signature over emails).
2. `isEmailAllowed` for the signed-in email.
3. `createSessionFromInvite` + `saveSession` + `rememberWorkspace`.
4. `onJoined` → `enterWorkspace()`.

### Other picker functions

| UI / action | Function |
|-------------|----------|
| List workspaces for this email | `workspacesForEmail` |
| Forget workspace from device | `forgetWorkspace` + clear local files/history helpers |
| Import backup JSON | `applyWorkspaceBackup` (verify signatures, merge messages) |
| Per-workspace storage badge | `estimateWorkspacesUsage` |
| Browser storage card | `useBrowserStorage` / `BrowserStorageCard` |
| P2P probe | `useP2pCapability` / `P2pCapabilityIndicator` |
| Theme | `ThemeToggle` (OS default or explicit light/dark) |
| Sign out identity | Clear ID credentials (workspace list empties) |

### Invite payload (function surface)

[`collab/inviteLink.ts`](../src/collab/inviteLink.ts):

| Function | Role |
|----------|------|
| `generateWorkspaceId` | 128-bit hex room secret (`generateRoomCode` from `@peerly/core`) |
| `encodeInviteLink` | `origin/#invite=<base64url JSON>` |
| `decodeInviteFromHash` | Shape-check only; crypto verify is separate |

Allow-list crypto: [`collab/allowList.ts`](../src/collab/allowList.ts)
(`signAllowList`, `verifyAllowList`, `isEmailAllowed`, `newerAllowList`).

Auth manager: [`collab/workspaceAuth.ts`](../src/collab/workspaceAuth.ts)
(create invite, invite more emails, only creator device can re-sign).

---

## Workspace shell

Component: [`Workspace`](../src/components/Workspace.tsx) +
[`CollabProvider`](../src/context/CollabContext.tsx) around
[`useCollab`](../src/hooks/useCollab.ts).

Layout:

- **Sidebar** (desktop permanent; mobile off-canvas drawer)
- **Main** — one of: channel chat, profile panel, workspace settings
- Optional **Files** column when `showFiles` is true on a channel route
- Banners: reauth (`ReauthBanner`), storage pressure (`StoragePressureBanner`)

Route → panel mapping:

| `workspaceRoute.view` | Main panel |
|-----------------------|------------|
| `channel` | `ChannelPanel` (+ optional `FilesPanel`) |
| `profile` | `ProfilePanel` |
| `settings` | `WorkspaceSettingsPanel` |

### Sidebar ([`Sidebar.tsx`](../src/components/Sidebar.tsx))

| Section | Functions |
|---------|-----------|
| Workspace header | Name, avatar, open settings |
| Connection | `ConnectionStatus`, relay online, RTC peer count, `P2pCapabilityIndicator` |
| Relay diagnostics | `useRelayDiagnostics` / health probes (Nostr) |
| Channels | List public channels; add / rename / delete / reorder |
| Direct messages | List DMs; start DM from peer; close local DM thread |
| Peers | Online peers with unread badges; start DM |
| Invite | `InvitePeople` — footer popover: copy link; creator can add/remove emails on allow-list |
| You | Profile entry; leave workspace; theme; build stamp |

Channel mutations (local store + P2P announce):

| Action | Local store | Network |
|--------|-------------|---------|
| Add channel | `addWorkspaceChannel` | `announceChannel` |
| Rename | `renameWorkspaceChannel` | `announceChannel` |
| Reorder | `moveWorkspaceChannel` | `announceChannel` (each moved) |
| Delete | `removeWorkspaceChannel` | `announceChannelDeletion` |
| Start DM | `ensureDmChannel` | `announceChannel` |
| Close DM | `removeDmChannel` | local only (thread closed on this device) |

Stores: [`channelStore.ts`](../src/collab/channelStore.ts),
[`dmStore.ts`](../src/collab/dmStore.ts).

### Channel view ([`ChannelPanel`](../src/components/workspace/ChannelPanel.tsx))

Path: `/workspace/channel/:channelId` optional `?files=1`

| Area | Behavior |
|------|----------|
| Header | Channel name or DM peer avatar; open sidebar (mobile); **video call**; **Files** toggle |
| Sync bar | `SyncStatusBar` — history / file sync progress |
| Banners | Connection notice/error (non-relay-offline), file errors, media errors, **incoming call** |
| Call UI | `VideoCall` when `inCall` |
| History | `MessageList` — text, files, reactions, edit/delete, NSFW blur, “new messages” pill |
| Composer | `MessageInput` — text, multi-file, paste, drag-drop |

Chat actions (via collab slices / `useCollab`):

| Function | Role |
|----------|------|
| `sendMessage` | Signed text payload on the active channel |
| `editMessage` / `deleteMessage` | Signed revisions |
| `toggleReaction` | Signed reaction records |
| `sendFiles` | Metadata + thumbnail first; body progressive |
| `requestFile` | On-demand full body from peers |
| `markFileNsfw` | Local screening flag |
| `startCall` / `endCall` / `declineCall` | Workspace-scoped video |
| Media toggles | Camera, mic, screen share, device switch |

Unread: [`unreadStore.ts`](../src/collab/unreadStore.ts) +
`useUnreadCounts` / `useAttention` (tab title, favicon, optional DM
notifications and sounds).

### Files panel ([`FilesPanel`](../src/components/FilesPanel.tsx))

Opened with `?files=1` or the Files button (same route flag).

- Lists shared files for the workspace / channel context
- Transfer progress from `useFileTransfer`
- Request download when body not cached
- Respects file sync mode (on-demand vs auto) and storage pressure

### Profile panel ([`ProfilePanel`](../src/components/workspace/ProfilePanel.tsx))

Path: `/workspace/profile`

- Display name / color / avatar for **this device’s** profile in the workspace
- Invite link display
- Profile persistence via `useProfileManager` / `profileStore` / session fields

### Workspace settings ([`WorkspaceSettingsPanel`](../src/components/workspace/WorkspaceSettingsPanel.tsx))

Path: `/workspace/settings`

| Setting | Function / storage |
|---------|-------------------|
| Rename workspace | Session + `rememberWorkspace` (local appearance; not a global rename authority) |
| Workspace icon | `uploadAvatar` / `removeAvatar` (`avatarService`) |
| Language | `useI18n` locale (EN/PL) |
| Theme | `ThemeToggle` / `themePreference` |
| File sync mode | `loadFileSyncMode` / `saveFileSyncMode` — on-demand vs auto-download full files |
| Notifications | enable/disable background DM notifications |
| Sounds | enable/disable attention + ringtone |
| Relay health | `RelayHealthCard` (Nostr probe) |
| P2P capability | Indicator + retry |
| Storage | `BrowserStorageCard`, per-workspace usage |
| Free local space | `clearWorkspaceFiles` — drop cached originals, keep metadata |
| Clear local history | `clearWorkspaceData` / `resetLocalHistory` — local only |
| Export backup | `buildWorkspaceBackup` — channels + newest messages + access (no DMs / full file bodies) |

---

## Collab core (`useCollab` and children)

[`useCollab`](../src/hooks/useCollab.ts) composes the live workspace room.

| Hook / module | Responsibility |
|---------------|----------------|
| `useRoom` | Join Trystero room for `workspaceId` / secret; signaling strategy |
| `wireRoomProtocol` | Action names, payload map, send/receive wiring |
| `useMultiChannelStore` | In-memory messages per channel; IndexedDB / local persistence |
| `useHistorySync` | Exchange history with peers; verify/sanitize signed entries |
| `useChannelSync` | Channel create/rename/delete announcements |
| `useFileTransfer` | Chunked file body transfer + cache |
| `usePeerProfiles` | Peer presence profiles |
| `useProfileManager` | Self profile broadcast |
| `useVideoCall` | WebRTC media, screen share, device selection |
| `useConnectionHealth` | connecting / ready / connected / error; TURN hints |
| `useUnreadCounts` | Per-channel unread from read cursors |
| `useAttention` | Document title, favicon badge, notifications |
| `useRoomAction` | Typed Trystero action helpers |

### Identity handshake

[`collab/identityHandshake.ts`](../src/collab/identityHandshake.ts) —
`createIdentityHandshake`:

- Challenge-response with device key
- Present ID token; peer verifies JWT + email on allow-list
- Live **key → userId** bindings for message/reaction verification
- Deny prefix for failed verification

Live messages take `senderUserId` **only** from handshake resolution, not from
payload claims (`useCollab` identity options).

### Message and reaction signing

| Module | Role |
|--------|------|
| `messageSigning` | Canonical bytes, verify history entries, sanitize unsigned/invalid |
| `reactionSigning` | Per-reaction signatures |
| `keyBindings` | Persist deviceKeyId → userId seen in this workspace |

### Progressive files

| Stage | What syncs |
|-------|------------|
| 1 | Channel structure + message history |
| 2 | File metadata + small WebP thumbnails |
| 3 | Full body on open (or auto if enabled and storage allows) |

Cache: `FileCache`. Storage pressure pauses auto-download of full bodies.

### Sensitive media

[`collab/nsfwGate`](../src/collab) / video screening — local NSFWJS inference;
blur until reveal. Receiver-side aid only; fails open if model unavailable.

---

## Supporting UI components

| Component | Role |
|-----------|------|
| `MessageList` | Virtualized-ish history, linkify, reactions, edit/delete UI, NSFW, jump-to-latest |
| `MessageInput` | Composer, attachments, paste/drag |
| `SafeMessageText` | Safe HTTPS linkification |
| `VideoCall` | Grid of streams, controls, device pickers |
| `InvitePeople` | Copy invite; creator-only allow-list edits |
| `ConnectionStatus` | Human-readable room connection state |
| `SyncStatusBar` | History/file sync progress |
| `ReauthBanner` | ID token expiring/expired → same-account reauth |
| `BrowserStorageCard` | Quota estimate, pressure, free/clear actions |
| `ThemeToggle` | Light / dark / system |
| `Avatar` | Identicon or custom image |
| `P2pCapabilityIndicator` | Local WebRTC / ICE diagnostics |

---

## Session and storage keys (conceptual)

| Concern | Module |
|---------|--------|
| Active session fields | [`session.ts`](../src/session.ts) |
| ID token / provider / email | same |
| Remembered workspaces | `workspaceStore` |
| Channels | `channelStore` |
| DM threads | `dmStore` |
| Read cursors | `unreadStore` |
| Profile | `profileStore` |
| File sync preference | `syncPreferences` |
| Theme | `themePreference` |
| Notification opt-in | `notificationPreference` |
| Device key bindings | `keyBindings` |
| Past self peer ids | `selfIdRegistry` |

Leaving a workspace (`onLeave`) clears the **active** workspace session and
returns to the picker; remembered workspaces and identity can remain so the
user can re-open without the invite link.

---

## Auth vs workspace summary

| Capability | Needs OIDC session? | Needs workspace room peers? |
|------------|---------------------|-----------------------------|
| See picker / create form | Sign-in to create/join | No |
| Join via invite | Yes + email on allow-list | No to enter; yes to sync |
| Chat / files / calls | Yes (active workspace) | Yes for live sync |
| Invite new emails | Creator **device** only | Peers learn newer allow-list over P2P |
| Copy invite link | Any member | No |
| Export / import backup | Import can be filtered by email | Offline-capable |
| Clear local history | Local only | Re-sync needs an online peer with data |

---

## Signaling and connectivity

| Piece | Role |
|-------|------|
| `getSignalingStrategy` | `nostr` (default) / `ws-relay` / `supabase` from env |
| `DEFAULT_NOSTR_RELAYS` / `VITE_NOSTR_RELAYS` | Curated public relays for discovery only |
| TURN env vars | Optional for strict NAT |
| `useRelayDiagnostics` | Echo-probe healthy relays (Nostr) |
| `useP2pCapability` | Local capability before blaming network |

Workspace members must share the same `workspaceId` (from invite). Signaling
does not grant membership — the allow-list + handshake does.

---

## Related packages

| Package / path | Role |
|----------------|------|
| [`@peerly/core`](../packages/core) | Room codes, signaling resolve, OIDC helpers, device keys, room media, avatar safety/processing, signed people lists (`block`/`friend`), React `useRoom` / `useRoomMedia` — full API in [`packages/core/README.md`](../packages/core/README.md) |
| `@trystero-p2p/*` | Underlying room transport strategies |
| App `src/protocol/` | Wire payload types and mappers |
| App `src/utils/avatarService` (and peers) | Workspace/profile avatars built on core `processAvatar*` + `isSafeAvatarUrl` |
| App `src/collab/friendsStore` | Personal friends list (email from handshake) for invite-from-friends |

---

## Quick “where do I change X?”

| Want to change… | Start here |
|-----------------|------------|
| URL paths | `src/routing.ts`, `useAppRouting.ts` |
| Create / join UX | `JoinScreen.tsx`, `inviteLink.ts`, `workspaceAuth.ts` |
| Sidebar / channel CRUD | `Sidebar.tsx`, `Workspace.tsx`, `channelStore.ts` |
| Messages | `useCollab.ts`, `wireRoomProtocol.ts`, `MessageList.tsx` |
| Files | `useFileTransfer.ts`, `FilesPanel.tsx`, `syncPreferences.ts` |
| Calls | `useVideoCall.ts`, `VideoCall.tsx` |
| Allow-list / invites | `allowList.ts`, `InvitePeople.tsx`, `identityHandshake.ts` |
| Storage / backup | `browserStorage` utils, `workspaceBackup.ts`, settings panel |
| i18n strings | `src/i18n.tsx` |
