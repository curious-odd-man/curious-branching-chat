# BranchChat — Implementation Plan: Encrypted Synchronized Discussions

**Inputs:** `google-drive-desktop-encrypted-chat-design.md` (revision 7), `requirements.md` (revision 10),
`adr.md` (ADR-001), current code (version 1.0.0)  
**Stack:** Electron + TypeScript, React, zod, Vitest, Playwright (unchanged); new: libsodium, Chokidar  
**Platform:** Windows 10 and Windows 11

---

## Progress

| Release | Phase                                        | Status                                                  | Notes                                                                                                                                                                                                                                                |
|---------|----------------------------------------------|---------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1.1     | 1 — Requirements, ADR, and protocol contract | Done                                                    | `requirements.md` revision 12 (FR-151 to FR-178), `adr-002-sync.md`, `sync-protocol.md`; event schemas in `src/shared/sync/` with 46 unit tests                                                                                                      |
| 1.1     | 2 — Schema version 2                         | Done                                                    | Clocks, last-writer stamps, migration 1 → 2, `sync.json` entry; 10 unit tests and 1 e2e test                                                                                                                                                         |
| 1.1     | 3 — Identity and key store                   | Done in code; **needs a Windows check**                 | `libsodium-wrappers` (standard build), key store with `safeStorage`, Settings section; 10 unit tests and 4 e2e tests. DPAPI on real Windows: checklist section L                                                                                     |
| 1.2     | 4 — Pure sync core                           | Done                                                    | Apply, merge, order, pending queue, normalization, builders, loading model; property test: 200 random runs with 3 members converge                                                                                                                   |
| 1.2     | 5 — Event cryptography and parts             | Done                                                    | Sealed and signed frames, parts; a 200 MB image in about 3.5 s, about 35 ms per part, so crypto stays in the main process                                                                                                                            |
| 1.2     | 6 — Folder transport and local sync state    | Done                                                    | Staging and move (rename or copy across drives), path and link checks, Chokidar, JSON state, registry, size limit setting                                                                                                                            |
| 1.2     | 7 — Sync service                             | Done                                                    | Outbox, inbox, receipts, cleanup, quarantine, incomplete files, replay check; random fault tests with 3 members                                                                                                                                      |
| 1.2     | 8 — Session integration                      | Done                                                    | Sessions and closed files, detached copies, moved files, "Отправить копию…", loading bubble with progress                                                                                                                                            |
| 1.2     | 9 — Wizards and invitations                  | Done in code                                            | Create, convert, join, roster; 5 e2e tests with two app instances                                                                                                                                                                                    |
| 1.2     | 10 — Hardening of release 1.2                | Done in code; **needs Windows and Google Drive checks** | Security review fixes, performance (5,000 messages: convert and join in 0.4 s), user guide, checklist section M. Google Drive tests (design Section 23) done: results as assumed. **Not done:** the manual matrix and an independent security review |
| 1.3     | 11 — Delivery marks and sync health          | Done in code                                            | One mark for every message (D-40, D-41), shared delivery state, retry rule, 7-day and 30-day cleanup, status line, "Проверить папки"; unit and e2e tests                                                                                             |
| 1.4     | 12 — Tray, background sync, notifications    | Done in code; **needs a Windows check**                 | Tray, life cycle without windows, notifications (D-42), settings, start with Windows, missing file with "Найти файл…", uninstall entry; unit and e2e tests. Windows: checklist section O                                                             |
| 1.5     | 13 — Add members after activation            | Done                                                    | "Пригласить участника…" (File menu and the members dialog), `member.added` to earlier members, invitation, roster shows who added; unit and e2e tests                                                                                                |
| 1.5     | 14 — Rejoin after key loss                   | Done in code; **needs a Windows check**                 | "Повторно пригласить…", `member.keys.replaced`, accept or reject in the status line, waiting events, old ID back on import; unit and e2e tests. Windows: checklist section P                                                                         |

Implementation decisions made in phases 1 to 3:

- The roster is a separate ZIP entry `sync.json`, not a field of `discussion.json`. The writer never copies it
  through, so "Отправить копию…" (release 1.2) only has to leave it out.
- Each recipient copy is signed separately, because the signature covers `recipientId` (sync-protocol.md section 6).
  The design said "sign once"; Ed25519 signing is cheap, so this costs nothing noticeable.
- An invitation carries the full discussion as a complete `.branchchat` file (version 2, with `sync.json` and images),
  split into parts. The import reuses the normal file reader and all its checks.
- Fingerprint: the first 32 hex characters of a SHA-256 with a context string, shown in 8 groups of 4.
- `sequence` is derived: when a file is read, messages and threads are sorted by clock and `sequence` is recomputed.
  The integrity check before every save refuses data that is not in clock order.
- Branch status and title changes now record the participant (`statusSet`, `titleSet`), also when that person has no
  name yet; the participant ID always exists in the settings.
- Keys are created the first time Settings shows the key section (first use, FR-155). If the key file cannot be read
  (for example DPAPI after a profile move) or belongs to another participant ID, it is kept as a backup and a new key
  is made; Settings says so.
- libsodium: the standard `libsodium-wrappers` build. SHA-256 comes from Node `crypto`.
- No temporary files in the shared folder (D-39, added after phase 3): files are written in a local staging folder and
  moved in when complete. Protocol version stays 1. Constants `STABLE_FILE_SECONDS` and
  `INCOMPLETE_FILE_GRACE_MINUTES` are in `src/shared/sync/schemas.ts`.
- Test builds protect keys with a stand-in for DPAPI; `BRANCHCHAT_E2E_KEYS=unavailable` simulates missing data
  protection. The release workflow checks that release builds do not contain it.
- The shared code had a syntax error in `src/shared/types/api.ts` (two lines joined); it was fixed first.
- `package.json` is still version 1.0.0. Set 1.1.0 when release 1.1 is tagged (release process, step 1).

Implementation decisions made in phases 4 to 10:

- In a synchronized discussion the roster is the source of display names; participant lists, assets, roster
  members, and read-state lists are kept sorted (`normalizeSynced`), so all copies are the same.
- `senderSeq` of a new local sync state starts at the current time in milliseconds, so a member whose sync state was
  lost continues with higher numbers; before this change such a member's new events would have been refused as
  replays (sync-protocol.md section 5).
- Key files in `keys/` are named by a UUID derived from the participant ID, because participant IDs are not always
  valid protocol file names (sync-protocol.md section 3).
- Invitations are verified in two steps: decrypt, then check every frame with the inviter's key from the snapshot's
  roster; the fingerprint check by the person is the trust anchor (sync-protocol.md 7.10).
- Received parts are stored by (sender, part ID): a member cannot replace or block another member's part (found in
  the security review; sync-protocol.md 7.2).
- A file that does not open is retried; the sender of a file from an unknown member (whose `member.added` has not
  arrived) is retried without quarantine.
- A complete message whose thread has not arrived waits in the pending queue; its image bytes wait in the local parts
  store.
- The sync service applies remote events through the open window's document session (same write queue), or directly
  to the file when no window shows the discussion. A window that opens a registered file waits for a running write.
- Release 1.2 still quits when the last window closes; sync then stops until the next start (tray: release 1.4).
- "Сделать обсуждение общим…" is offered only for an open discussion that is not shared yet.
- The crypto review in phase 10 was done by the same developer; an independent review is still needed before the
  release (plan, phase 10, task 4).

Implementation decisions made in phase 11:

- Own messages in a synchronized discussion have one combined mark (D-40, answer to Q-40), instead of the read
  indicator: one grey check = written to the shared folder; two grey checks = delivered to all; one green check = read
  by at least one member; two green checks = read by all. A read state wins over a delivery state. While the message
  is still being written, a grey clock is shown (Q-41). The list per member (click) shows written, delivered, or read.
- D-41 (answer to Q-41): the mark applies to all messages. Each member sends `delivery.added` with the IDs of
  messages of others that are in its copy; the receiver adds them to the sender's entry in the ZIP entry
  `delivery.json` (set union, like `readstate.added`). Protocol version stays 1: the old build is not released.
- The delivery event is stored in the outbox and the sync state is saved before the document changes. After a crash
  between the two steps, the next scan sends the same IDs again; this does no harm.
- A message in the own copy counts as received by the local member. A member counts as "delivered" when its
  `delivery.json` entry has the message, or (own messages) when its receipt arrived.
- Normal discussions use the same mark without delivery: no mark while nobody has read, one green check some, two
  green checks all. The old three-state indicator is removed.
- The rule is one pure function, `messageMarkOf` in `src/shared/domain/messageMark.ts`.
- "Отправить копию…" also removes `delivery.json`.
- A retry keeps the time of the first write, so the 30-day limit counts from the first write.
- Folder health comes from the scan (folder missing) and from writes (EACCES or EPERM: no permission); a successful
  write or scan clears it.
- "Проверить папки" is a button in the window header; it scans, runs the retry rule and cleanup, and refreshes the
  view.

**Q-40 (answered → D-40).** One grey check: written; two grey checks: delivered to all; one green check: read by at
least one member; two green checks: read by all.

**Q-41 (answered → D-41).** Two details that the answer to Q-40 does not cover:
a) What does an own message show before it is written to the shared folder (usually less than a second; longer if the
folder is not available)? Implemented: a grey clock 🕓. Options: (i) keep the clock; (ii) no mark; (iii) one grey check
already.
b) Other people's messages in a synchronized discussion, and all messages in a normal discussion, keep the existing
read indicator (one grey check: nobody read; two grey checks: some read; two accent-colored checks: all read). In a
shared discussion this means two grey checks have one meaning on own messages ("delivered") and another on other
messages ("some read"). Options: (i) keep it as it is; (ii) in synchronized discussions, use the green colors for
reading on all messages (one green check: some read; two green checks: all read; no mark: nobody read); (iii) the same
green scheme also in normal discussions. Recommendation: a) (i), b) (ii).
**Answer:** a) keep the clock. b) The table (one grey check written, two grey checks delivered to all, one green check
read by at least one, two green checks read by all) applies to all messages, own and of others. Delivery of others'
messages: each member tells all members which messages it received (like the read state). Normal discussions also use
the green checks.

---

## 1. Assumptions

### 1.1 Google Drive test results (design Section 23, confirmed)

| Test                                     | Result (confirmed)                 | Used in        |
|------------------------------------------|------------------------------------|----------------|
| Delete rights (Editor, Content manager)  | Deletion is allowed in both setups | Phase 7        |
| "Available offline" applies to new files | Yes                                | Phase 9 (text) |
| Shared folder location                   | Normal Windows drive and path      | Phase 9        |

The real tests were done (Phase 10, task 1). All results are as assumed. No change to the code or the design.

### 1.2 Design questions

All design questions (Q-01 to Q-39) have answers. They are decisions D-01 to D-38 in the design document.

### 1.3 No users yet

There are no users of version 1.0. The plan does not keep compatibility with version 1.0 files or with version 1.0 of
the application (D-28). Version 1 files that exist (test files) are migrated when opened.

---

## 2. Release strategy

| Release | Name                           | What the user gets                                                                                                                   | Depends on |
|---------|--------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|------------|
| 1.1     | Groundwork                     | No visible sync. All files use schema version 2. Settings shows the person's encryption key fingerprint                              | 1.0        |
| 1.2     | Synchronized discussions       | Create, convert, and join synchronized discussions. All changes sync. Large messages and images in parts. Sync while the app is open | 1.1        |
| 1.3     | Delivery marks and sync health | Grey checks, per-member details, retry rule, cleanup of old files, sync status line                                                  | 1.2        |
| 1.4     | Background sync                | Tray, sync with no window open, start with Windows, new-message notifications                                                        | 1.2        |
| 1.5     | Membership changes             | Invite new members after activation; rejoin after key loss                                                                           | 1.2        |

Releases 1.3, 1.4, and 1.5 are independent of each other. You can release them in any order after 1.2.

### 2.1 Why release 1.1 is separate

- The format change (schema version 2, Lamport clocks, migration) affects every discussion, also the non-synchronized
  ones. Release 1.1 ships it alone, so a problem in the format is not mixed with sync problems.
- libsodium and `safeStorage` are new packaging risks. Release 1.1 ships them early, on real Windows machines, before
  any user data depends on them ("risk early" approach of the MVP plan).

### 2.2 Compatibility rules between releases 1.2 to 1.5

These rules let members with different releases use the same synchronized discussion.

1. Release 1.2 defines the zod schemas of **all** event types of the design (Section 9.1), also the types that later
   releases send.
2. Release 1.2 applies `member.added` (D-13 needs no confirmation). Release 1.5 only adds the UI to send it.
3. Releases 1.2 to 1.4 keep `member.keys.replaced` in the pending queue and show "Обновите приложение, чтобы принять
   изменение ключей". Release 1.5 processes the queue.
4. An event with an unknown type or a higher protocol version waits in the pending queue. The app shows "Обновите
   приложение". It does not send a delivery receipt for it, so the sender keeps it.
5. Delivery receipts are sent from release 1.2 (cleanup needs them). Release 1.3 only shows them and adds the retry
   rule and the age-based cleanup.
6. The invitation states the minimum protocol version. The join wizard refuses an invitation with a higher version
   and asks the person to update.

---

## 3. Approach

1. **Pure core first.** Event apply rules, ordering, and merge rules are plain TypeScript in `src/shared/sync/`, with
   unit tests, before any transport or UI exists.
2. **Fake transport for tests.** A `FolderTransport` wrapper injects delays, duplicates, reordering, conflict copies,
   failed writes, and failed deletes. Tests use a temporary folder as the shared folder.
3. **Two-instance end-to-end tests.** Playwright starts two or three app instances with isolated profiles (the
   existing e2e profile mechanism) and one temporary shared folder.
4. **Non-synchronized discussions keep their behavior.** Existing unit and e2e tests stay green in every phase (with
   fixtures updated to version 2 in Phase 2).
5. **Traceability.** Each phase lists the design decisions (D-nn) it completes.

Effort sizes as in the MVP plan: **S** ≈ up to 3 days, **M** ≈ about a week, **L** ≈ about two weeks.

---

## 4. Release 1.1 — Groundwork

### Phase 1 — Requirements, ADR, and protocol contract (M)

**Goal:** the product documents and the protocol contract agree with the design.

Tasks

- `requirements.md` revision 11: new FR numbers for synchronized discussions, detached copies, schema version 2,
  identity, large messages, delivery marks, tray, notifications. Change FR-026 (order by clock), FR-124 (roster
  members are known participants), FR-012 (no version 1.0 compatibility). Remove "real-time sync", "cloud storage",
  and "cryptographic identity verification" from out of scope.
- ADR-001 new revision (or ADR-002): event log over a shared folder, libsodium, Chokidar, JSON local state,
  `safeStorage`, tray.
- Protocol document `docs/02-done/sync-protocol.md`: envelope fields, canonical serialization rule, all event types,
  header-and-parts format, shared-folder layout, file names, size limits, cleanup rules, protocol version rules
  (Section 2.2).
- zod schemas for all events and the invitation in `src/shared/sync/schemas.ts` (schemas only, no logic).

Exit criteria

- Requirements, ADR, and protocol document are reviewed.
- Event schemas compile and have unit tests (valid and invalid examples).

Decisions: groundwork for all.

### Phase 2 — Schema version 2 (M)

**Goal:** all files use schema version 2, with clocks, and keep their visible behavior.

Tasks

- `CURRENT_SCHEMA_VERSION` = 2. The app writes only version 2 (D-28).
- Migration 1 → 2 in `src/main/document/migrations.ts` (the existing mechanism): gives each message a clock that
  keeps the current order; adds status and title clocks to threads. Runs when a version 1 file is opened; the file is
  saved as version 2 on the next write.
- Version 2 schema: message `clock`; thread status and title clocks with participant ID (D-24); optional `sync`
  object (protocol version, `members[]` with public keys, fingerprint, `addedBy`, key history). Integrity checks for
  the new fields.
- Order: sort messages by (clock, author ID, message ID) on load and after each change; `sequence` always equals the
  index. Local changes set the clock to one more than the highest clock in the file, so the visible order of a
  non-synchronized discussion does not change.
- A file with a `sync` object opens as a detached copy in release 1.1 (no registry exists yet). Local changes keep the
  `sync` object (D-26).
- Update test fixtures to version 2. Add fixtures: version 1 file (migration), version 2 with `sync` object, missing
  image bytes.

Exit criteria

- A version 1 fixture opens, shows the same order, and is saved as version 2.
- A version 2 fixture with a `sync` object opens, accepts new messages, and saves without data loss.
- All existing tests pass after the fixture update.

Decisions: D-03, D-05 (order rule), D-24 (data), D-26 (detached behavior), D-28.

### Phase 3 — Identity and key store (M)

**Goal:** each Windows user has an encryption identity, stored safely.

Tasks

- Add `libsodium-wrappers` (standard build; the sumo build is not needed). Load it in the main process.
  Check that the packaged app loads it (no native build).
- `src/main/crypto/keyStore.ts`: create Ed25519 and X25519 key pairs on first use, bound to the `participantId` in
  `settings.json`. Store the private keys encrypted with `safeStorage` in the user data folder, in a separate file.
- If `safeStorage` is not available, do not create keys. Show the reason.
- Fingerprint: short hash of both public keys, shown in groups.
- Public-key bundle: create, export as a file (`.bckey`) and as text; parse and validate a bundle.
- Settings: section "Ключ шифрования" with the fingerprint, "Скопировать мой ключ", and "Сохранить мой ключ…".
- Never send private keys to the renderer. Never log keys.

Exit criteria

- On a clean Windows 10 and 11 machine, the installed 1.1 creates keys, survives an update, and shows the same
  fingerprint after restart.
- Unit tests: key creation, bundle round trip, refusal of a damaged bundle.

Decisions: D-14, D-21 (bundle format).

### Release 1.1 checklist

- Release notes: "Новый формат файлов (версия 2); ключ шифрования в настройках".
- Windows test checklist: new section for keys and version 2 files.

---

## 5. Release 1.2 — Synchronized discussions

### Phase 4 — Pure sync core (L)

**Goal:** a tested library that applies events to a discussion and gives the same result in any arrival order.

Tasks

- `src/shared/sync/apply.ts`: apply each event type to `DocumentContents`: `message.sent` (complete message),
  `branch.created`, `branch.status.set`, `branch.title.set`, `readstate.added`, `member.added`, `profile.updated`.
- Loading messages: a model for a message header with missing parts, outside `DocumentContents`. The message is
  applied to the document only when all parts are present (D-30).
- Lamport clock rules: local clock update on send and on receive.
- Merge rules of design Section 9.6, with last writer wins for status and title (D-24).
- A message for a closed branch is accepted; the branch stays closed (D-07).
- Dependency check: an event that needs a missing or still-loading thread, message, or member returns "pending". A
  pending queue that retries after each applied event.
- Rules for loading messages (D-37): not readable, not a branch source, not unread; sending in the same thread
  does not mark them read.
- Idempotence: applying the same event twice changes nothing.
- Event builders: build an event from each local change, so local and remote changes give the same data.
- Known participants = roster members (D-25): update the read indicator rules for synchronized discussions.
- Property tests: random sets of events in random orders, with duplicates, give identical documents on all simulated
  members.

Exit criteria

- Property tests pass for 3 simulated members and thousands of random orders.
- The integrity check passes after every apply.

Decisions: D-04, D-05, D-07, D-08 (read-state events), D-12, D-13 (apply side), D-23, D-24, D-25, D-30 (model),
D-37 (rules).

### Phase 5 — Event cryptography and parts (M)

**Goal:** signed, encrypted events and parts.

Tasks

- Canonical serialization (rule from the protocol document) with test vectors.
- Sign with Ed25519; encrypt per recipient with `crypto_box_seal`; decrypt; verify the signature with the sender's
  key from the roster (accepted current key or key history).
- Check recipient ID, conversation ID, and sender after decryption.
- Header and parts (D-30): split images (always) and large content into 4 MB parts; the signed `message.sent` lists
  each part (part ID, kind, SHA-256, size); encrypt each part per recipient; on receipt check each part against the
  signed list. The same method for large invitations.
- Run crypto in the main process first. Move it to a utility process if a 4 MB part blocks the main process for more
  than about 50 ms.
- Negative tests: changed ciphertext, changed signed fields, wrong recipient, unknown sender, part with a wrong hash,
  part that no header lists.

Exit criteria

- Test vectors and negative tests pass.
- A 200 MB image is split, encrypted, decrypted, and checked without blocking the UI.

Decisions: settled decision 2, D-10, D-11, D-30.

### Phase 6 — Folder transport and local sync state (M)

**Goal:** safe file operations in the shared folder and durable local state.

Tasks

- `src/main/transport/folderTransport.ts`: `list`, `read`, `publish` (write and close in the local staging folder, then
  move into the shared root: `rename` on the same volume, copy and delete across volumes; D-39, protocol 3.4),
  `delete`, `watch` (Chokidar), all relative to the shared root. Refuse path traversal, links, and names outside the
  layout of design Section 13. Check the size limit before a read.
- Shared-folder layout: create `branchchat-sync.json`, `keys/`, `inbox/<participantId>/` as needed.
- Folder test: publish, read, and delete a `.bctest` file in `.test/`, through the staging folder.
- Staging folder `<userData>/sync/<conversationId>/staging/`: emptied at start; the outbox writes those copies again.
- Local sync state in JSON files with `writeFileAtomically`: outbox, processed events and parts, loading messages
  (part bytes in a local folder), pending queue, peer state, quarantine, own receipt files with write time (design
  Section 18).
- Sync registry: `documentId` → local file path, shared folder path.
- Settings: "Максимальный размер файла" (5 MB to 1 000 MB, default 30 MB) (D-11, D-30).
- Test wrapper that injects delays, duplicates, reordering, conflict copies (`name (1).bcmsg`), failed writes, and
  failed deletes.

Exit criteria

- Unit tests for path safety, atomic write, and state recovery after a simulated crash.

Decisions: D-11, D-17, D-18.

### Phase 7 — Sync service (L)

**Goal:** reliable outgoing and incoming processing for all registered discussions.

Tasks

- `src/main/sync/syncService.ts`: one worker per registered discussion while the app runs.
- Outgoing flow (design Section 14, steps 1 to 7): outbox, per-recipient copies, `message.sent` before its parts,
  retry of failed writes with the same ID. No activity-based retry yet (release 1.3).
- Incoming flow (design Section 15): stable size and time wait, size limit, decrypt (a file that does not open is
  retried and quarantined only after 10 unchanged minutes, protocol 9.6), verify, replay check by ID and sender
  sequence, part check against the header, loading-message store, apply through the core when complete, pending
  queue, delivery receipts, delete.
- Cleanup (D-19): the inbox owner deletes each processed file (events, parts, receipts, invitations). If a delete
  fails, record the file as processed and ignore it later. The sender deletes its own event and part files after the
  receipt. Age-based cleanup comes in release 1.3.
- Scans: at start, after watcher errors, when the folder becomes available again, every 5 minutes, and on request.
- Deduplicate by authenticated event ID or part ID plus recipient ID, never by file name.
- Quarantine of invalid files (local list only). Safe error codes in logs.
- Unknown event types and higher protocol versions wait in the pending queue (Section 2.2).

Exit criteria

- Tests with the fault-injecting transport: three members, random delays, duplicates, conflict copies, parts before
  headers, failed deletes, partial files from a cross-volume copy, a crash during the move from the staging folder,
  and crashes at each step of design Section 15 give identical discussions and no duplicate messages. No temporary
  file ever appears in the shared root.

Decisions: D-09 (receipts only), D-19, D-23, D-30.

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
- Loading messages in the message list (D-30, D-37): a bubble at its clock position with author and time; a progress
  bar "Загружается: N из M частей (X из Y МБ)" that updates when each part arrives; a grey placeholder line until the
  content arrives; partial message with text and "Изображение загружается…" placeholders, each with its own progress
  (D-31). No read mark, no "Reply to this", no unread highlight; text can be selected and copied.
- Main → renderer update for loading progress: send only the progress of the changed message, not the whole
  discussion.
- Detached copy detection: a file with a `sync` object whose path is not the registered path for its `documentId`
  (D-06, D-26).
- Moved file (D-27): when the registered path is missing and a file with that `documentId` opens, ask "Это ваше
  общее обсуждение, которое было перемещено?"; "Да" updates the registry.
- "Отправить копию…" (D-26): save a version 2 copy without the `sync` object, for manual sharing.
- Read indicator: roster members are known participants (D-25).

Exit criteria

- Two-instance e2e test: messages, branches, nested branches, status, title, images, large messages, and read state
  reach the other instance with and without the window open. While parts are held back, the bubble shows the
  progress bar, and the progress grows as parts are released.
- A detached copy opened on a third profile behaves as a normal discussion.

Decisions: D-01, D-06, D-07, D-08, D-10, D-12, D-25, D-26, D-27 (open-time part), D-30, D-31, D-37.

### Phase 9 — Wizards and invitations (L)

**Goal:** people can create, convert, and join a synchronized discussion.

Tasks

- Menu items (D-20): File > "Новое общее обсуждение…", "Присоединиться к обсуждению…", "Сделать обсуждение общим…".
- Create wizard (design Section 12.3). The shared folder is a normal Windows path (Section 1.1). Refuse a local file
  path inside the shared folder (D-01). Folder test. Collect bundles from `keys/`, from a file, or from pasted text
  (D-21). Review name and fingerprint; accept or discard.
- Convert wizard (design Section 12.4): add the `sync` object to the open discussion; ask to move the file if it is in
  the shared folder (D-02).
- Invitation: signed, encrypted to the invitee, with roster, full `DocumentContents`, all image bytes, and the minimum
  protocol version; header and parts for large invitations.
- Join wizard (design Section 12.5): publish bundle, folder test, wait for the invitation with progress, check the
  inviter's fingerprint, save the local file, register, start sync (D-22).
- Roster view: invited / joined (join = delivery receipt for the invitation).
- Wizard texts for Google Drive for Desktop (design Section 19). Russian strings in `ru.ts`.

Exit criteria

- Three-instance e2e test: create with two invitees, both join, all exchange messages. Convert an existing discussion
  with images larger than the size limit; the invitees see the full history.

Decisions: D-02, D-20, D-21, D-22, D-23.

### Phase 10 — Hardening of release 1.2 (M)

**Goal:** release 1.2 is safe to ship.

Tasks

1. ~~Do the three Google Drive tests (design Section 23).~~ Done: all results as assumed (Section 1.1).
2. Manual test matrix on real Windows machines with Google Drive for Desktop: My Drive folder and shared drive;
   streaming with offline pinning; mirroring; Drive paused, signed out, restarted; permission removed and restored;
   recipient offline for a day.
3. Security tests: replay, changed files, hostile names, path traversal, too large files, no plain text or private
   keys in the shared folder or logs.
4. Security review of the crypto code and the protocol document.
5. Performance: 5,000-message discussion converted and joined; 200 MB image sent; UI stays responsive.
6. Russian user guide: synchronized discussions, what the provider can see, key loss consequences, detached copies,
   "Отправить копию…", loading messages.

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

- Message marks (D-09): one grey check when the header and all parts are written for all recipients; two grey checks
  when all recipients sent receipts for the header and all parts. Stored in the local sync state only.
- Message details: per member — written, delivered, read (design Section 16.3).
- Retry rule (D-29): at start and every 30 minutes, write an unconfirmed copy again only if a valid event or receipt
  from that recipient arrived since the last write of the copy. No maximum. Parts use the same rule.
- Age-based cleanup (D-34): delete own receipt files still present after 7 days; delete own sent files with no receipt
  after 30 days.
- Sync status line in the window (D-35): folder missing, permission problem, invalid files, waiting for an update.
- "Проверить папки" action in the window.

Exit criteria

- E2E tests: marks change as receipts arrive; retry happens only after recipient activity; age-based cleanup with a
  test clock; status line shows a removed folder.

Decisions: D-09, D-29, D-34, D-35.

---

## 7. Release 1.4 — Background sync

### Phase 12 — Tray, background sync, notifications (M)

**Goal:** sync continues when all windows are closed, and the person learns about new messages.

Tasks

- When the last window closes and at least one synchronized discussion exists, stay in the tray (D-33). Otherwise quit
  as today.
- One-time notice on the first close to the tray (D-33).
- Tray menu: open a discussion (registered list), sync status (D-35), "Проверить папки", "Выход".
- Windows notification for each new message from another member (D-33), raised when the message is processed:
  author, discussion name, and up to 100 characters of plain text, cut at a word boundary, with "…"; images as
  "[изображение]" (D-38). Click opens the discussion at the message. Settings: "Уведомления о новых сообщениях"
  (default on) and "Показывать текст в уведомлениях" (default on).
- Settings: "Запускать вместе с Windows" (D-36: on after the first synchronized discussion; the wizard says so).
  Starts in the tray, with no window.
- "Выход" is a normal close: a downloaded update installs then (FR-141).
- Missing registered file at start: warning in the tray menu with "Найти файл…" (D-27).
- Opening a `.branchchat` file while the app is in the tray opens a window (single instance stays).
- Installer: uninstall removes the start-with-Windows entry.

Exit criteria

- E2E tests: close all windows; a message from another instance is applied to the file and a notification is raised;
  with "Показывать текст в уведомлениях" off, the notification has no text; reopen shows the message.
- Windows check: start with Windows, tray icon at different display scales, notifications, update installs on exit.

Decisions: D-16, D-27 (start-time part), D-33, D-35, D-36, D-38, D-42.

Implementation decisions

- D-42 (answers during phase 12): no notification when the discussion's window is active; more than 3 new messages
  of one discussion in one scan give one summary notification; a left click on the tray icon shows a window or opens
  the most recently used synchronized discussion.
- The sync engine reports the messages of others that a scan applied (`onNewMessages`), after all parts arrived. The
  history of an invitation raises no notification.
- Every request to quit sets a flag on `before-quit` (tray or File "Выход", Windows sign-out, the updater, test
  tools). A window close that the person cancels (an unsent draft) clears it.
- File "Выход" lost its Alt+F4 accelerator: Alt+F4 closes only the window, as in other Windows programs.
- The app stays in the tray if a registered synchronized discussion of this identity exists, also when its file is
  missing (the tray then shows "Найти файл…"; the chosen file must have the same `documentId`).
- "Запускать вместе с Windows" uses `app.setLoginItemSettings` with the name "BranchChat" and the argument
  `--background`. The first synchronized discussion turns it on once (`startWithWindowsSettled`); a choice of the
  person settles it too. Started with `--background`, the app opens no window and quits if no synchronized discussion
  exists. The uninstaller removes the `Run` and `StartupApproved\Run` values (not on an update).
- The tray icon is `build/icon.ico`, shipped as `resources/tray.ico`.
- A click on a notification opens the discussion; the window takes the message to show from the main process
  (`takeFocusRequest`), so a new window does not lose it.
- Test builds replace the tray, notifications, and the login item with recorders (`__tray`, `__notifications`,
  `__loginItem`); the release check searches for these names.

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
- The re-invited person's app sets the old ID as the global `participantId` (D-32).
- Other members: request in the status line "Ключи <name> изменились. Сверьте отпечаток с этим человеком." Accept or
  reject. No Windows notification (D-35).
- Until acceptance: events signed with the new keys wait in the pending queue; no encryption to the new keys (D-32).
- Rejection: keep the old keys; show a warning on both sides (D-32).
- Key history in the roster; old signatures stay valid.
- Process `member.keys.replaced` events that releases 1.2 to 1.4 kept in the pending queue.

Exit criteria

- E2E test: delete the keys and settings of one instance; re-invite; two other members accept; messages flow both
  ways. A third member rejects; that member's messages do not reach the person and both sides see the warning.

Decisions: D-15, D-32.

Implementation decisions (phases 13 and 14)

- Inviting: the sync engine adds the members (`addMembers`), writes `member.added` to the earlier members, then the
  invitation (with the file as the snapshot) goes to each new member. The wizard's "invite" mode reads keys from the
  shared folder of the open discussion and does not offer members again. The members dialog shows "пригласил(а): …".
- The e2e test of phase 13 uses three app instances (Boris, who did not create the discussion, invites Clara), not
  four.
- Re-inviting (`replaceKeys`): the re-inviter uses the new keys at once (it checked the fingerprint) and writes
  `member.keys.replaced` to all others. Its own copies for the person without a receipt are written again with the
  new key.
- An outbox item has an optional `memberId`: the re-invitation goes to the inbox of the person's new ID, but it is
  sealed with the member's (new) key, and the receipt comes from the old ID.
- The person's app on import: `KeyStore.rebind(newId, oldId)` and `settings.participantId = oldId`; the key file of the
  new ID is removed from `keys/`; the sync of the discussion restarts; files that the new key cannot open are set
  aside (`keptFiles`); `rejoin.heardFrom` starts with the inviter.
- Other members: the request is local state (`keyRequests`), shown in the status line with the new fingerprint and in
  the tray menu; no notification (D-35). Accept writes own unconfirmed copies again with the new key and reads the
  waiting events. Reject keeps the old keys; "Всё-таки принять" stays available.
- A bad signature of a known member waits like an incomplete file (10 minutes), and never ends in quarantine while a
  key request for that member exists.
- The e2e test of phase 14 uses three instances: Anna re-invites (and so accepts), Clara rejects, then accepts.
- Fixes found on the way: dialogs inside the page header were drawn under the message list (the overlay now has a
  stacking order); the members dialog takes the focus when it opens, so Escape works.

---

## 9. Testing strategy

| Level            | What                                                                                           | Where                   |
|------------------|------------------------------------------------------------------------------------------------|-------------------------|
| Unit             | Schemas, migration, apply rules, merge, order, crypto vectors, parts, path safety, local state | Vitest                  |
| Property         | Random event orders and duplicates converge                                                    | Vitest                  |
| Fault injection  | Delays, duplicates, reordering, conflict copies, failed writes and deletes, crashes            | Vitest + test transport |
| End-to-end       | Two or three app instances with isolated profiles and one temporary shared folder              | Playwright              |
| Manual (Windows) | Google Drive for Desktop matrix, tray, notifications, start with Windows, update on exit       | Windows test checklist  |
| Review           | Crypto code and protocol                                                                       | Before release 1.2      |

---

## 10. Risks and mitigations

| Risk                                                                    | Mitigation                                                                                      |
|-------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Google Drive behaves differently later (product change)                 | Results confirmed in Phase 10 task 1; the "record as processed" fallback stays as a safety rule |
| `safeStorage` not available or keys lost after a Windows profile change | Release 1.1 tests it early; release 1.5 adds rejoin                                             |
| Large messages or invitations slow down sync                            | 4 MB parts; loading state in the UI; crypto in a utility process if needed (Phase 5)            |
| Members on different releases                                           | Compatibility rules (Section 2.2); minimum protocol version in invitations                      |
| A late message appears above already-read messages                      | It stays highlighted as unread; user guide explains it                                          |
| Writes from the sync service and a window to the same file              | One write queue per file; the sync service uses the open session when a window exists           |
| Chokidar misses events on cloud drives                                  | Periodic scans are the source of truth (Phase 7)                                                |
| Detached copies confuse users                                           | FR-117 warning; "Отправить копию…" makes a clean copy                                           |
| Notifications show private information                                  | Setting to hide the text (D-38); Settings text and user guide explain it                        |

---

## 11. Definition of done (every phase)

- New code has tests at the right level. CI is green.
- Existing tests for non-synchronized discussions pass (fixtures in version 2 from Phase 2).
- The CI-built installer installs and runs on a clean Windows machine.
- No lint boundary violations: pure sync logic stays in `src/shared/`.
- No private keys, plain text, or local state in the shared folder or in logs.
- Strings are in Russian and live in `ru.ts`.
- The decisions listed for the phase are met. The Progress table is updated.
