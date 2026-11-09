# BranchChat — Implementation Plan: Encrypted Synchronized Discussions

**Inputs:** `google-drive-desktop-encrypted-chat-design.md` (revision 3), `requirements.md` (revision 10),
`adr.md` (ADR-001), current code (version 1.0.0)  
**Stack:** Electron + TypeScript, React, zod, Vitest, Playwright (unchanged); new: libsodium, Chokidar  
**Platform:** Windows 10 and Windows 11

---

## Progress

| Release | Phase                                        | Status      | Notes |
|---------|----------------------------------------------|-------------|-------|
| 1.1     | 1 — Requirements, ADR, and protocol contract | Not started |       |
| 1.1     | 2 — Schema version 2 and detached copies     | Not started |       |
| 1.1     | 3 — Identity and key store                   | Not started |       |
| 1.2     | 4 — Pure sync core                           | Not started |       |
| 1.2     | 5 — Event cryptography                       | Not started |       |
| 1.2     | 6 — Folder transport and local sync state    | Not started |       |
| 1.2     | 7 — Sync service                             | Not started |       |
| 1.2     | 8 — Session integration                      | Not started |       |
| 1.2     | 9 — Wizards and invitations                  | Not started |       |
| 1.2     | 10 — Hardening of release 1.2                | Not started |       |
| 1.3     | 11 — Delivery marks and sync health          | Not started |       |
| 1.4     | 12 — Tray and background sync                | Not started |       |
| 1.5     | 13 — Add members after activation            | Not started |       |
| 1.5     | 14 — Rejoin after key loss                   | Not started |       |

---

## 1. Assumptions

This plan uses these assumptions. If an assumption changes, update the phases that refer to it.

### 1.1 Google Drive test results (design Section 23, assumed)

| Test                                     | Assumed result                     | Used in        |
|------------------------------------------|------------------------------------|----------------|
| Delete rights (Editor, Content manager)  | Deletion is allowed in both setups | Phase 7        |
| "Available offline" applies to new files | Yes                                | Phase 9 (text) |
| Shared folder location                   | Normal Windows drive and path      | Phase 9        |

Do the real tests before release 1.2 (Phase 10, task 1).

### 1.2 Open design questions (recommendations used)

Questions Q-24 to Q-35 do not have answers yet. The plan uses the recommendation of each question.

| Question | Assumption used in this plan                                                                                                                                                                               | Phases     |
|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|
| Q-24     | Branch status and title: last writer wins by (Lamport clock, participant ID)                                                                                                                               | 4          |
| Q-25     | All roster members are known participants for the read indicator                                                                                                                                           | 4, 8       |
| Q-26     | A detached copy keeps the same `documentId` and its version 2 data, which the app ignores. "Отправить копию…" makes a clean version 1 copy                                                                 | 2, 8       |
| Q-27     | Moved file: the app asks "Это ваше общее обсуждение, которое было перемещено?"; a missing registered file shows a warning                                                                                  | 8, 12      |
| Q-28     | Non-synchronized discussions stay schema version 1                                                                                                                                                         | 2          |
| Q-29     | Activity = any valid event or receipt from that recipient since the last write of the copy. No maximum retries. Chunks use the same rule                                                                   | 11         |
| Q-30     | Large payloads are split into fixed 4 MB chunks. Size limit setting: 5 MB to 1 000 MB, default 30 MB                                                                                                       | 5, 7, 9    |
| Q-31     | Separate placeholder "Изображение загружается…" until all chunks arrive                                                                                                                                    | 8          |
| Q-32     | Re-invitation sets the old ID as the global `participantId`. Events with unaccepted keys wait in the pending queue. No encryption to unaccepted keys. A rejected key keeps the old key and shows a warning | 14         |
| Q-33     | Tray only when a synchronized discussion exists. "Start with Windows" on after the first synchronized discussion. No new-message notifications in v1. One-time notice on the first close to the tray       | 12         |
| Q-34     | With deletion allowed: the recipient deletes processed files in its inbox; the sender deletes receipts in its inbox after processing. Own files with no receipt are deleted after 30 days                  | 7, 11      |
| Q-35     | Status line in the window and in the tray menu. Windows notification only for key change requests                                                                                                          | 11, 12, 14 |

---

## 2. Release strategy

| Release | Name                           | What the user gets                                                                                            | Depends on |
|---------|--------------------------------|---------------------------------------------------------------------------------------------------------------|------------|
| 1.1     | Groundwork                     | No visible sync. The app opens schema version 2 files. Settings shows the person's encryption key fingerprint | 1.0        |
| 1.2     | Synchronized discussions       | Create, convert, and join synchronized discussions. All changes sync. Images. Sync while the app is open      | 1.1        |
| 1.3     | Delivery marks and sync health | Grey checks, per-member details, retry rule, cleanup of old files, sync status line                           | 1.2        |
| 1.4     | Background sync                | Tray, sync with no window open, start with Windows                                                            | 1.2        |
| 1.5     | Membership changes             | Invite new members after activation; rejoin after key loss                                                    | 1.2        |

Releases 1.3, 1.4, and 1.5 are independent of each other. You can release them in any order after 1.2.

### 2.1 Why release 1.1 comes first

- D-03 makes old versions refuse schema version 2 files. Release 1.1 can open them. When release 1.2 comes, most
  users already have a version that opens detached copies, because the app updates itself (FR-141).
- libsodium and `safeStorage` are new packaging risks. Release 1.1 ships them early, on real Windows machines, before
  any user data depends on them (approach "risk early" of the MVP plan).

### 2.2 Compatibility rules between releases

These rules let members with different releases (1.2 to 1.5) use the same discussion.

1. Release 1.2 defines the zod schemas of **all** event types of the design (Section 9.1), also the types that later
   releases send.
2. Release 1.2 applies `member.added` (D-13 needs no confirmation). Release 1.5 only adds the UI to send it.
3. Release 1.2 to 1.4 keep `member.keys.replaced` in the pending queue and show "Обновите приложение, чтобы принять
   изменение ключей". Release 1.5 processes the queue.
4. An event with an unknown type or a higher protocol version waits in the pending queue. The app shows "Обновите
   приложение". It does not send a delivery receipt for it, so the sender keeps it.
5. Delivery receipts are sent from release 1.2. Release 1.3 only shows them and adds the retry rule.
6. The invitation states the minimum protocol version. The join wizard refuses an invitation with a higher version
   and asks the person to update.

---

## 3. Approach

1. **Pure core first.** Event apply rules, ordering, and merge rules are plain TypeScript in `src/shared/sync/`, with
   unit tests, before any transport or UI exists.
2. **Fake transport for tests.** A `FolderTransport` wrapper injects delays, duplicates, reordering, conflict copies,
   and failed writes. Tests use a temporary folder as the shared folder.
3. **Two-instance end-to-end tests.** Playwright starts two or three app instances with isolated profiles (the
   existing e2e profile mechanism) and one temporary shared folder.
4. **Non-synchronized discussions do not change.** All existing unit and e2e tests stay green in every phase.
5. **Requirements traceability.** Each phase lists the design decisions (D-nn) it completes.

Effort sizes as in the MVP plan: **S** ≈ up to 3 days, **M** ≈ about a week, **L** ≈ about two weeks.

---

## 4. Release 1.1 — Groundwork

### Phase 1 — Requirements, ADR, and protocol contract (M)

**Goal:** the product documents and the protocol contract agree with the design.

Tasks

- Close design questions Q-24 to Q-35. Update Section 1.2 of this plan with the answers.
- `requirements.md` revision 11: new FR numbers for synchronized discussions, detached copies, schema version 2,
  identity, delivery marks, tray. Change FR-026 (order) and FR-124 (known participants) for synchronized discussions.
  Remove "real-time sync", "cloud storage", and "cryptographic identity verification" from out of scope.
- ADR-001 new revision (or ADR-002): event log over a shared folder, libsodium, Chokidar, JSON local state,
  `safeStorage`.
- Protocol document `docs/02-done/sync-protocol.md`: envelope fields, canonical serialization rule, all event types,
  chunk format, shared-folder layout, file names, size limits, protocol version rules (Section 2.2).
- zod schemas for all events and the invitation in `src/shared/sync/schemas.ts` (schemas only, no logic).

Exit criteria

- Requirements, ADR, and protocol document are reviewed.
- Event schemas compile and have unit tests (valid and invalid examples).

Decisions: groundwork for all.

### Phase 2 — Schema version 2 and detached copies (M)

**Goal:** the app reads and writes schema version 2 files and treats them as normal discussions.

Tasks

- `CURRENT_SCHEMA_VERSION` handling: the app reads version 1 and 2. It writes version 1 files as version 1 and
  version 2 files as version 2 (Q-28). Today `validateBeforeWrite` refuses any version except the current one; change
  this rule.
- Version 2 schema: `sync` object (protocol version, `members[]` with public keys, fingerprint, `addedBy`, key
  history), message `clock`, thread status and title clocks. Integrity checks for the new fields.
- Migration 1 → 2 function (Section 7.3 of the design): gives each message a clock that keeps the current order.
  Not yet called from the UI.
- Order in a version 2 file: sort messages by (clock, author ID, message ID) when the file is loaded and after each
  change. `sequence` always equals the index.
- A version 2 file opens as a normal discussion in 1.1 (detached). Local changes in it keep the version 2 data and set
  correct clocks on new messages.
- Unit tests and fixtures: version 2 files with members, clocks, missing image bytes; migration; round trip.

Exit criteria

- A version 2 fixture opens, shows the right order, accepts new messages, and saves without data loss.
- All existing tests pass. Version 1 files are not changed to version 2.

Decisions: D-03, D-05 (order rule), D-06 (detached behavior).

### Phase 3 — Identity and key store (M)

**Goal:** each Windows user has an encryption identity, stored safely.

Tasks

- Add `libsodium-wrappers-sumo` (or `libsodium-wrappers`; select by the APIs used). Load it in the main process.
  Check that the packaged app loads it (no native build).
- `src/main/crypto/keyStore.ts`: create Ed25519 and X25519 key pairs on first use, bound to the `participantId` in
  `settings.json`. Store the private keys encrypted with `safeStorage` in the user data folder, in a separate file.
- If `safeStorage` is not available, do not create keys. Show the reason.
- Fingerprint: short hash of both public keys, shown in groups.
- Public-key bundle: create, export as a file (`.bckey`) and as text; parse and validate a bundle.
- Settings: section "Ключ шифрования" with the fingerprint and "Скопировать мой ключ" / "Сохранить мой ключ…".
- Never send private keys to the renderer. Never log keys.

Exit criteria

- On a clean Windows 10 and 11 machine, the installed 1.1 creates keys, survives an update, and shows the same
  fingerprint after restart.
- Unit tests: key creation, bundle round trip, refusal of a damaged bundle.

Decisions: D-14, D-21 (bundle format).

### Release 1.1 checklist

- Release notes: "Подготовка к общим обсуждениям; ключ шифрования в настройках".
- Windows test checklist: new section for keys and version 2 files.

---

## 5. Release 1.2 — Synchronized discussions

### Phase 4 — Pure sync core (L)

**Goal:** a tested library that applies events to a discussion and gives the same result in any arrival order.

Tasks

- `src/shared/sync/apply.ts`: apply each event type to `DocumentContents`: `message.sent` (registers images without
  bytes), `branch.created`, `branch.status.set`, `branch.title.set`, `readstate.added`, `member.added`,
  `profile.updated`.
- Lamport clock rules: local clock update on send and on receive.
- Merge rules of design Section 9.6, with last writer wins for status and title (Q-24).
- A message for a closed branch is accepted; the branch stays closed (D-07).
- Dependency check: an event that needs a missing thread, message, or member returns "pending". A pending queue that
  retries after each applied event.
- Idempotence: applying the same event twice changes nothing.
- Event builders: build an event from each local change (the inverse of apply), so local and remote changes give the
  same data.
- Known participants = roster members (Q-25): update the read indicator rules for version 2 files.
- Property tests: random sets of events in random orders, with duplicates, give identical documents on all simulated
  members.

Exit criteria

- Property tests pass for 3 simulated members and thousands of random orders.
- The integrity check passes after every apply.

Decisions: D-04, D-05, D-07, D-08 (read-state events), D-12, D-13 (apply side), D-23.

### Phase 5 — Event cryptography (M)

**Goal:** signed, encrypted envelopes and chunks.

Tasks

- Canonical serialization (rule from the protocol document) with test vectors.
- Sign with Ed25519; encrypt per recipient with `crypto_box_seal`; decrypt; verify the signature with the sender's
  key from the roster (current key or key history).
- Check recipient ID, conversation ID, and sender after decryption.
- Chunks: split a large payload into 4 MB parts (Q-30); encrypt each part; the signed header (in `message.sent` or the
  invitation) holds the SHA-256 and the number of chunks; check the SHA-256 after assembly.
- Run crypto in the main process first. Move it to a utility process if a 4 MB chunk blocks the main process for more
  than about 50 ms.
- Negative tests: changed ciphertext, changed signed fields, wrong recipient, unknown sender, wrong chunk.

Exit criteria

- Test vectors and negative tests pass.
- A 200 MB payload is chunked, encrypted, decrypted, and checked without blocking the UI.

Decisions: settled decision 2, D-10, D-11.

### Phase 6 — Folder transport and local sync state (M)

**Goal:** safe file operations in the shared folder and durable local state.

Tasks

- `src/main/transport/folderTransport.ts`: `list`, `read`, `writeAtomic` (temp name in the same folder, then rename),
  `delete`, `watch` (Chokidar), all relative to the shared root. Refuse path traversal, links, and names outside the
  layout of design Section 13. Check the size limit before a read.
- Shared-folder layout: create `branchchat-sync.json`, `keys/`, `inbox/<participantId>/` as needed.
- Folder test: write, read, and delete a file in `.test/`.
- Local sync state in JSON files with `writeFileAtomically`: outbox, processed events, pending queue, chunk store, peer
  state, quarantine (design Section 18).
- Sync registry: `documentId` → local file path, shared folder path.
- Settings: "Максимальный размер файла" (5 MB to 1 000 MB, default 30 MB) (D-11, Q-30).
- Test wrapper that injects delays, duplicates, reordering, conflict copies (`name (1).bcmsg`), and failed writes.

Exit criteria

- Unit tests for path safety, atomic write, and state recovery after a simulated crash.

Decisions: D-11, D-17, D-18.

### Phase 7 — Sync service (L)

**Goal:** reliable outgoing and incoming processing for all registered discussions.

Tasks

- `src/main/sync/syncService.ts`: one worker per registered discussion while the app runs.
- Outgoing flow (design Section 14, steps 1 to 7): outbox, per-recipient copies, message before its image chunks,
  retry of failed writes with the same event ID. No activity-based retry yet (release 1.3).
- Incoming flow (design Section 15): stable-size wait, size limit, decrypt, verify, replay check by event ID and
  sender sequence, apply through the core, pending queue, chunk assembly, delivery receipt, delete.
- Cleanup with deletion allowed (Section 1.1): the recipient deletes processed files in its inbox; the sender deletes
  receipts in its inbox after it records them, and deletes its own sent files after the receipt. If a delete fails,
  record the file as processed (D-19 fallback).
- Scans: at start, after watcher errors, when the folder becomes available again, every 5 minutes, and on request.
- Deduplicate by authenticated event ID plus recipient ID, never by file name.
- Quarantine of invalid files (local list only). Safe error codes in logs.
- Unknown event types and higher protocol versions wait in the pending queue (Section 2.2).

Exit criteria

- Tests with the fault-injecting transport: three members, random delays, duplicates, conflict copies, and crashes at
  each step of design Section 15 give identical discussions and no duplicate messages.

Decisions: D-09 (receipts only), D-19, D-23.

### Phase 8 — Session integration (L)

**Goal:** synchronized discussions work in the existing windows.

Tasks

- `DocumentSession`: after each local change in a registered discussion, build the event and give it to the sync
  service. Detached copies do not emit events.
- Remote events: apply through the same write queue, then send `documentChanged` to the window.
- No window open: the sync service applies events to the file directly, with the same write queue rules. Lock so that
  a window that opens during a write gets the new state.
- Lifecycle for release 1.2: sync runs for all registered discussions while the app runs. The app still quits when the
  last window closes (tray comes in release 1.4).
- Detached copy detection: a version 2 file whose path is not the registered path for its `documentId` (D-06).
- Moved file (Q-27): when the registered path is missing and a file with that `documentId` opens, ask whether it is
  the moved discussion; "Да" updates the registry.
- "Отправить копию…" (Q-26): save a version 1 copy without sync data, for manual sharing.
- Image placeholder "Изображение загружается…" until all chunks arrive (Q-31); the existing placeholder for damaged
  data.
- Read indicator: roster members are known participants (Q-25).

Exit criteria

- Two-instance e2e test: messages, branches, nested branches, status, title, images, and read state reach the other
  instance with and without the window open.
- A detached copy opened on a third profile behaves as a normal discussion.

Decisions: D-01, D-06, D-07, D-08, D-10, D-12.

### Phase 9 — Wizards and invitations (L)

**Goal:** people can create, convert, and join a synchronized discussion.

Tasks

- Menu items (D-20): File > "Новое общее обсуждение…", "Присоединиться к обсуждению…", "Сделать обсуждение общим…".
- Create wizard (design Section 12.3). The shared folder is a normal Windows path (Section 1.1). Refuse a local file
  path inside the shared folder (D-01). Folder test. Collect bundles from `keys/`, from a file, or from pasted text
  (D-21). Review name and fingerprint; accept or discard.
- Convert wizard (design Section 12.4): migration 1 → 2 on the open discussion; ask to move the file if it is in the
  shared folder (D-02).
- Invitation: signed, encrypted to the invitee, with roster, full `DocumentContents`, and all image bytes; chunks for
  large invitations; minimum protocol version.
- Join wizard (design Section 12.5): publish bundle, folder test, wait for the invitation, check the inviter's
  fingerprint, save the local file, register, start sync (D-22).
- Roster view: invited / joined (join = delivery receipt for the invitation).
- Wizard texts for Google Drive for Desktop (design Section 19). Russian strings in `ru.ts`.

Exit criteria

- Three-instance e2e test: create with two invitees, both join, all exchange messages. Convert an existing discussion
  with images; the invitees see the full history.

Decisions: D-02, D-20, D-21, D-22, D-23.

### Phase 10 — Hardening of release 1.2 (M)

**Goal:** release 1.2 is safe to ship.

Tasks

1. Do the three Google Drive tests (design Section 23). Correct Section 1.1 if a result differs.
2. Manual test matrix on real Windows machines with Google Drive for Desktop: My Drive folder and shared drive;
   streaming with offline pinning; mirroring; Drive paused, signed out, restarted; permission removed and restored;
   recipient offline for a day.
3. Security tests: replay, changed files, hostile names, path traversal, very large files, no plain text or private
   keys in the shared folder or logs.
4. Security review of the crypto code and the protocol document.
5. Performance: 5,000-message discussion converted and joined; 100 MB image sent; UI stays responsive.
6. Russian user guide: synchronized discussions, what the provider can see, key loss consequences, detached copies.

Exit criteria

- All tests pass. Review findings are fixed or accepted in writing.

### Release 1.2 checklist

- Release notes describe the limits: no delivery marks yet, sync only while the app is open, no new members after
  activation, key loss cannot be repaired yet.
- Windows test checklist: new section for synchronized discussions.

---

## 6. Release 1.3 — Delivery marks and sync health

### Phase 11 — Delivery marks and sync health (M)

**Goal:** the sender sees delivery state, and sync problems are visible.

Tasks

- Message marks (D-09): one grey check when all copies are written; two grey checks when all recipients sent
  receipts. Stored in the local sync state only. Image chunks do not change the marks.
- Message details: per member — written, delivered, read (design Section 16.3).
- Retry rule (D-09, Q-29): at start and every 30 minutes, write an unconfirmed copy again only if a valid event or
  receipt from that recipient arrived since the last write of the copy. Same rule for chunks.
- Cleanup of own sent files that never got a receipt: delete after 30 days (Q-34).
- Sync status line in the window (Q-35): folder missing, permission problem, invalid files, waiting for an update.
- "Проверить папки" action in the window.

Exit criteria

- E2E tests: marks change as receipts arrive; retry happens only after recipient activity; status line shows a removed
  folder.

Decisions: D-09, Q-29, Q-34, Q-35.

---

## 7. Release 1.4 — Background sync

### Phase 12 — Tray and background sync (M)

**Goal:** sync continues when all windows are closed.

Tasks

- When the last window closes and at least one synchronized discussion exists, stay in the tray (Q-33). Otherwise quit
  as today.
- One-time notice on the first close to the tray.
- Tray menu: open a discussion (registered list), sync status, "Проверить папки", "Выход".
- Settings: "Запускать вместе с Windows"; set on after the first synchronized discussion is created or joined, and the
  wizard says so. Starts minimized to the tray.
- "Выход" is a normal close: a downloaded update installs then (FR-141).
- Missing registered file: warning in the tray menu with "Найти файл…" (Q-27).
- Opening a `.branchchat` file while the app is in the tray opens a window (single instance stays).
- Installer: uninstall removes the start-with-Windows entry.

Exit criteria

- E2E tests: close all windows, a message from another instance is applied to the file; reopen shows it.
- Windows check: start with Windows, tray icon at different display scales, update installs on exit.

Decisions: D-16, Q-27, Q-33, Q-35.

---

## 8. Release 1.5 — Membership changes

### Phase 13 — Add members after activation (S)

**Goal:** any member can invite a new person into an active discussion.

Tasks

- Action "Пригласить участника…" in a synchronized discussion: collect the bundle, check the fingerprint, send the
  invitation with the current discussion, send `member.added` to all members (D-13).
- Roster view shows who added each member.
- Apply side already exists since release 1.2 (Section 2.2).

Exit criteria

- E2E test: a member who is not the initiator invites a fourth person; all members see the new member and the new
  member gets messages written after the invitation (D-23).

Decisions: D-13, D-23.

### Phase 14 — Rejoin after key loss (M)

**Goal:** a person who lost the keys can return with the old participant ID.

Tasks

- Action "Повторно пригласить участника…": select a roster member, collect the new bundle, check the fingerprint, send
  a re-invitation and `member.keys.replaced` (D-15).
- The re-invited person's app sets the old ID as the global `participantId` (Q-32).
- Other members: a request "Ключи <name> изменились. Сверьте отпечаток с этим человеком." Accept or reject. Windows
  notification for this request (Q-35).
- Until acceptance: events signed by the new keys wait in the pending queue; no encryption to the new keys (Q-32).
- Rejection: keep the old keys; show a warning on both sides.
- Key history in the roster; old signatures stay valid.
- Process `member.keys.replaced` events that releases 1.2 to 1.4 kept in the pending queue.

Exit criteria

- E2E test: delete the keys and settings of one instance; re-invite; two other members accept; messages flow both
  ways. A third member rejects; that member's messages do not reach the person and both sides see the warning.

Decisions: D-15, Q-32.

---

## 9. Testing strategy

| Level            | What                                                                                    | Where                   |
|------------------|-----------------------------------------------------------------------------------------|-------------------------|
| Unit             | Schemas, migration, apply rules, merge, order, crypto vectors, path safety, local state | Vitest                  |
| Property         | Random event orders and duplicates converge                                             | Vitest                  |
| Fault injection  | Delays, duplicates, reordering, conflict copies, failed writes, crashes                 | Vitest + test transport |
| End-to-end       | Two or three app instances with isolated profiles and one temporary shared folder       | Playwright              |
| Manual (Windows) | Google Drive for Desktop matrix, tray, start with Windows, update on exit               | Windows test checklist  |
| Review           | Crypto code and protocol                                                                | Before release 1.2      |

---

## 10. Risks and mitigations

| Risk                                                                    | Mitigation                                                                            |
|-------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| Assumed Google Drive results are wrong                                  | Phase 10 task 1 before release 1.2; D-19 fallback is implemented from the start       |
| `safeStorage` not available or keys lost after a Windows profile change | Release 1.1 tests it early; release 1.5 adds rejoin                                   |
| Large invitations or images slow down sync                              | 4 MB chunks; crypto in a utility process if needed (Phase 5)                          |
| Members on different releases                                           | Compatibility rules (Section 2.2); minimum protocol version in invitations            |
| A late message appears above already-read messages                      | It stays highlighted as unread; user guide explains it                                |
| Writes from the sync service and a window to the same file              | One write queue per file; the sync service uses the open session when a window exists |
| Chokidar misses events on cloud drives                                  | Periodic scans are the source of truth (Phase 7)                                      |
| Detached copies confuse users                                           | FR-117 warning; "Отправить копию…" makes a clean version 1 copy                       |

---

## 11. Definition of done (every phase)

- New code has tests at the right level. CI is green.
- Existing tests for non-synchronized discussions pass unchanged.
- The CI-built installer installs and runs on a clean Windows machine.
- No lint boundary violations: pure sync logic stays in `src/shared/`.
- No private keys, plain text, or local state in the shared folder or in logs.
- Strings are in Russian and live in `ru.ts`.
- The decisions listed for the phase are met. The Progress table is updated.
