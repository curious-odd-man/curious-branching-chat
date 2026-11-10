# ADR-002: Synchronized discussions through a shared folder

**Status:** Accepted  
**Date:** 2026-11-10  
**Context documents:** `docs/01-future/google-drive-desktop-encrypted-chat-design.md` (revision 6),
`docs/01-future/google-drive-sync-implementation-plan.md`, `requirements.md` (revision 12, section 5.12),
`sync-protocol.md`  
**Relation to ADR-001:** Extends it. The technology (Electron + TypeScript) does not change.

---

## 1. Context

BranchChat stores one discussion in one `.branchchat` file that people exchange manually. People want a discussion
that stays in sync between computers, with no server, no hosting cost, and no cloud API. Many people already run a sync
product such as Google Drive for Desktop, which shows a shared folder as a normal Windows path.

The sync product is untrusted: it can read files, delay them, duplicate them, and deliver them in any order.

## 2. Decision

1. **Event log over a shared folder.** Each change is a signed event. The application writes one encrypted copy per
   recipient into the recipient's inbox folder in the shared folder. The local `.branchchat` file stays outside the
   shared folder and is the materialized view (D-01, D-04).
2. **No provider code.** One transport: a local folder. No Google API, no OAuth, no server (D-18).
3. **Ordering by Lamport clock** for all files, with schema version 2. Last writer wins for branch status and title
   (D-05, D-24, D-28).
4. **Cryptography: libsodium** (`libsodium-wrappers`, the standard WebAssembly build, no native build). Ed25519
   signatures, `crypto_box_seal` per recipient. SHA-256 (fingerprints, parts) comes from Node `crypto`. No custom
   constructions. No forward secrecy in v1. The sumo build is not needed: the protocol uses only functions of the
   standard build.
5. **Private keys** are encrypted with Electron `safeStorage` (Windows DPAPI for the user account) and stored in the
   user data folder. They never reach the renderer.
6. **Local sync state** in JSON files with the existing atomic write (`writeFileAtomically`). No SQLite (D-17).
7. **Watching: Chokidar**, with periodic full scans as the source of truth (D-17).
8. **Pure core.** Event schemas, canonical serialization, apply rules, and merge rules live in `src/shared/sync/`
   (no Electron, React, or Node imports; lint enforces this). Crypto lives in `src/main/crypto/`, transport in
   `src/main/transport/`, the sync service in `src/main/sync/`.
9. **Tray.** The application stays in the notification area while a synchronized discussion exists (D-16, release
   1.4).

## 3. Options considered

| Option                                                 | Result                                                                            |
|--------------------------------------------------------|-----------------------------------------------------------------------------------|
| Put the `.branchchat` file itself in the shared folder | Refused: plain text reaches the provider; two writers overwrite each other        |
| Google Drive API with OAuth                            | Refused: credentials, app verification, provider lock-in                          |
| Own server or relay                                    | Refused: hosting cost and operation                                               |
| Event log in a shared folder (selected)                | Works with any sync product that shows a folder; end-to-end encryption; no server |
| SQLite for local state                                 | Refused: native module, rebuild for Electron, packaging work                      |
| Node `fs.watch` only                                   | Refused: less reliable on network and cloud drives; Chokidar plus scans           |
| tweetnacl or Node `crypto`                             | Refused: tweetnacl has no sealed box; Node `crypto` has no `crypto_box_seal`      |

## 4. Consequences

- Schema version 2 for all files. Version 1.0 of the application cannot open them (accepted: no users yet).
- A message can appear above messages that the reader already saw, when a late message from an offline member
  arrives. It stays highlighted as unread.
- The sync product sees metadata: accounts, folder structure, file sizes, times.
- Large images travel in 4 MB parts. A loading message is shown with a progress bar.
- The application must run (window or tray) for sync to happen.
- libsodium adds about 0.5 MB (WebAssembly embedded in JavaScript) to the installer.
- A security review of the crypto code is needed before release 1.2.

## 5. Releases

| Release | Content                                                                  |
|---------|--------------------------------------------------------------------------|
| 1.1     | Schema version 2, clocks, roster entry, keys and fingerprint in Settings |
| 1.2     | Synchronized discussions (create, convert, join, all events, parts)      |
| 1.3     | Delivery marks, retry rule, cleanup, sync status line                    |
| 1.4     | Tray, start with Windows, notifications                                  |
| 1.5     | Add members after activation, rejoin after key loss                      |
