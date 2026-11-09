# Design: Encrypted Synchronized BranchChat Discussions over a Shared Folder

**Status:** Draft, revision 2 (aligned with the code; open questions in Section 21)  
**Platform:** Windows 10 and Windows 11 (same as the MVP)  
**Transport model:** A shared local folder that a sync product (for example Google Drive for Desktop) keeps in sync  
**Backend:** None  
**Google integration:** None. No Drive API, no OAuth, no Google credentials in the application.

---

## 0. How to use this document

- Section 2 records facts from the current code. These facts are the baseline for this design.
- Section 3 lists the conflicts between revision 1 of this design and the current code.
- Sections 4 to 19 give the proposed design. Text marked **[Pending Q-nn]** depends on an answer.
- Section 21 contains all open questions. Each question has context, options, a recommendation, and an
  **Answer:** line. Write your answer on that line.
- Do not start the implementation plan until all questions in Section 21 have answers.

---

## 1. Overview

BranchChat today stores one discussion in one `.branchchat` file. Users exchange the full file manually (for example
through WhatsApp). The application does not merge copies.

This feature adds a second way to share a discussion: a **synchronized discussion**. In a synchronized discussion:

- Each participant keeps a local `.branchchat` file, as today.
- Each local change becomes an **event**. The application signs the event and encrypts it separately for each other
  participant.
- The application writes the encrypted events into a shared folder. A sync product (for example Google Drive for
  Desktop) moves the files between computers. The application does not know which sync product it is.
- Each participant applies the incoming events to its local `.branchchat` file.

The sync product is untrusted and eventually consistent. Files can arrive late, more than once, or in a different
order. The sync product must not see message content.

Discussions that are not synchronized continue to work exactly as today.

---

## 2. Current application facts (from the code)

### 2.1 Document file (`src/main/document/`, `src/shared/validation/schemas.ts`)

A `.branchchat` file is a ZIP with these entries:

| Entry                          | Content                                                                                        |
|--------------------------------|------------------------------------------------------------------------------------------------|
| `manifest.json`                | `format` = `"branchchat"`, `schemaVersion` = `1`, `documentId`, `createdAt`, `generator?`      |
| `discussion.json`              | `title`, `createdAt`, `updatedAt`, `participants[]`, `threads[]` (messages inside), `assets[]` |
| `readstate.json`               | `participantId` → list of `messageId` that the participant has read                            |
| `assets/images/<sha256>.<ext>` | Image bytes (PNG, JPEG, GIF, WebP), stored without compression                                 |

- `participants[]`: `participantId`, `displayName`.
- `threads[]`: `threadId`, `parentThreadId?`, `sourceMessageId?`, `quoteText?`, `selectionStart?`, `selectionEnd?`,
  `title?`, `status` (`open` | `closed`), `createdAt`, `createdBy`, `messages[]`. One thread is the main thread.
- `messages[]`: `messageId`, `threadId`, `sequence`, `authorId`, `authorDisplayName`, `createdAt`, `content`
  (rich-text JSON subset, never HTML), `assetReferences[]`.
- `assets[]`: `assetId` (= SHA-256), `path`, `mediaType`, `size`, `sha256`.
- All objects keep unknown fields (`passthrough`). Unknown ZIP entries are copied through on save.
- A file with a newer `schemaVersion` is refused, never rewritten. Migrations exist as a mechanism, but none are
  defined yet.

Note: revision 1 of this design said that read state is "keyed by message, with participant identifiers as values".
That is not correct. Read state is keyed by participant, with message IDs as values.

### 2.2 Integrity rules (`src/shared/validation/integrity.ts`)

The application refuses to load or save a file that breaks these rules:

- Exactly one main thread. No cycles in the thread hierarchy.
- `message.sequence` must equal the index of the message in its thread (0, 1, 2, …).
- Every message author and every thread creator must be in `participants[]`.
- A branch must have `sourceMessageId` and `quoteText`. The source message must be in the parent thread.
- Every image in a message must be in `assetReferences` and in `assets[]`.

### 2.3 Changes a user can make (`src/main/application/documentSession.ts`)

| Change                                  | Effect in the file                                                                             |
|-----------------------------------------|------------------------------------------------------------------------------------------------|
| Send a message (with or without images) | New message at the end of the thread; new assets; read state of sender                         |
| Create a branch ("Reply to this")       | New thread; source message becomes read for the creator                                        |
| Close or reopen a branch                | `thread.status` changes. Any participant can do it. Main thread cannot close                   |
| Set or remove a branch title            | `thread.title` changes. Any participant can do it                                              |
| Mark a message / thread / all as read   | Local participant's entry in `readstate.json` grows                                            |
| First write by a participant            | Participant is added to `participants[]`                                                       |
| Display name changed in Settings        | On the next write, `participants[].displayName` changes; old messages keep `authorDisplayName` |

- The discussion title is set from the file name at creation. The UI cannot change it.
- Messages cannot be edited or deleted. Branches cannot be deleted.
- A closed branch refuses new messages (`THREAD_CLOSED`).
- Read state only grows. A message becomes read only by an explicit action, by sending in the same thread, or by
  creating a branch from it. Viewing a message never marks it read (FR-112).
- Each message shows who has read it, with three states: all, some, none (FR-122, FR-123). "Known participants" are
  the participants in `participants[]`.

### 2.4 Saving and windows

- Each change rewrites the full ZIP with an atomic replace. Writes are coalesced. There is no Save command.
- The application does not watch the file. If another program changes the file while it is open, the next save
  overwrites that change.
- One window shows one file. If two files with the same `documentId` are open, the application shows a warning
  (FR-117). It does not merge.
- The application has a single instance. It quits when the last window closes. There is no tray icon and no
  background work.

### 2.5 Local state (`src/main/local-state/settings.ts`)

- `settings.json` in the user's application data folder: `participantId` (random, created once), `displayName`,
  and UI flags.
- If `settings.json` is lost or corrupt, the person gets a new `participantId` (accepted in FR-020).
- There are no keys and no other local databases.

### 2.6 Other constraints

- UI language is Russian.
- NFR-015: no artificial limits on message length, image size, or file size.
- Electron already uses `contextIsolation: true`, `sandbox: true`, a narrow preload API, and zod validation of IPC.
- Lint rule: `src/shared/` must not import Electron, React, or Node built-ins.
- Current dependencies do not include Chokidar, libsodium, or SQLite.
- Out of scope in the MVP requirements: real-time sync, cloud storage, merging copies, cryptographic identity. This
  feature changes these decisions. The requirements document must get a new revision.

---

## 3. Conflicts between revision 1 and the current code

| #   | Revision 1 assumption                                                 | Current code                                                                                                | Question   |
|-----|-----------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|------------|
| C1  | Events are encrypted; the BranchChat file is shared                   | The file contains the full history in plain text. Sharing it through the sync folder removes the encryption | Q-01       |
| C2  | Only `message.sent` events                                            | Six kinds of change exist (Section 2.3)                                                                     | Q-04       |
| C3  | Order by event metadata and a tie-break rule                          | `sequence` must equal the local index. Concurrent messages give a different order on each computer          | Q-05       |
| C4  | Message is read when it is displayed; receipt goes to the sender only | Read only by explicit action; read state is visible to all participants                                     | Q-08       |
| C5  | Sent / delivered checkmarks                                           | No such state exists. No place to store it                                                                  | Q-09       |
| C6  | Image handling stays unchanged                                        | Images are inside the ZIP. Other participants cannot get them without a new transfer                        | Q-10       |
| C7  | Enforce file-size limits                                              | NFR-015: no artificial limits. Sealed boxes need the full payload in memory                                 | Q-10       |
| C8  | No display-name change after creation                                 | Settings lets the user change the name (FR-024, FR-138)                                                     | Q-12       |
| C9  | Roster comes from invitations                                         | A participant appears only after the first write (FR-022, FR-124)                                           | Q-13       |
| C10 | Per-conversation identity; returning user keeps participant ID        | One `participantId` per Windows user. Losing settings loses the ID                                          | Q-14, Q-15 |
| C11 | Incoming files are processed continuously                             | The app quits when the last window closes                                                                   | Q-16       |
| C12 | Incoming changes update the conversation                              | An open session does not accept external changes                                                            | Section 9  |
| C13 | Any participant may share their BranchChat file                       | Merging copies is out of scope; FR-117 only warns                                                           | Q-06       |
| C14 | Remote messages always apply                                          | A closed branch refuses messages; a branch needs its source message first                                   | Q-07       |
| C15 | SQLite for local transport state                                      | No native modules. Local state uses JSON with atomic writes                                                 | Q-17       |
| C16 | Preserve the format                                                   | New fields may need `schemaVersion` 2. Old app versions refuse version 2 files                              | Q-03       |
| C17 | A recipient deletes files in its inbox                                | The files belong to the sender's Google account. Delete rights must be verified                             | Q-19       |
| C18 | Google Drive adapter, generic folder adapter, local-only mode         | "Local-only + manual file exchange" is the existing behavior. Google Drive adds nothing beyond a folder     | Q-18       |
| C19 | Menu "Chat → New chat"                                                | The menu has File, Edit, Help                                                                               | Q-20       |

---

## 4. Goals and non-goals

### Goals

- Synchronized discussions between two or more participants, through a shared folder.
- No server, no hosting cost, no Google API.
- End-to-end encryption and sender authentication for every event.
- Delivery to an offline participant after the sync product has moved the file.
- At-least-once delivery, idempotent processing, recovery from missed events, duplicates, and sync delays.
- All existing features work in a synchronized discussion: branches, nested branches, branch status and title, rich
  text, images, read state, "who has read" indicator, unread counts.
- Discussions that are not synchronized work exactly as today.
- A guided wizard to create a synchronized discussion and to join one.

### Non-goals and limitations

- No anonymity from the sync provider. The provider can see accounts, folder membership, file sizes, times, and
  traffic volume.
- No guarantee of immediate delivery. No way to know that a local file has reached the cloud.
- No protection against a participant who copies or shares plain text.
- No multi-device identity.
- No message edit or delete (same as today). No branch delete (same as today).
- No leave and no remove participant in v1.
- No forward secrecy in v1.
- No new attachment types. Only the existing image types.

---

## 5. Architecture (mapped to the code)

| Component                   | Location (proposed)                       | Notes                                                                               |
|-----------------------------|-------------------------------------------|-------------------------------------------------------------------------------------|
| Event model and apply rules | `src/shared/sync/`                        | Pure TypeScript. Applies an event to `DocumentContents`. Testable without Electron  |
| Existing domain             | `src/shared/domain/`                      | Reused. Local changes still go through the existing functions                       |
| Document file               | `src/main/document/`                      | Reused. Schema changes only if Q-03 allows them                                     |
| Document session            | `src/main/application/documentSession.ts` | Extended: emits an event for each local change; accepts remote events               |
| Sync service                | `src/main/sync/`                          | Outbox, inbox processing, receipts, scans, retries                                  |
| Cryptography                | `src/main/crypto/`                        | libsodium. Runs in the main process or a utility process. Never in the renderer     |
| Key store                   | `src/main/crypto/keyStore.ts`             | Private keys protected with Electron `safeStorage` (DPAPI on Windows)               |
| Transport                   | `src/main/transport/`                     | `FolderTransport`: one implementation for any sync product that exposes a folder    |
| Local sync state            | User data folder, per discussion          | Never in the shared folder. Format depends on Q-17                                  |
| Sync registry               | User data folder                          | List of synchronized discussions: `documentId`, local file path, shared folder path |
| Wizard UI                   | `src/renderer/components/sync/`           | Russian strings in `src/shared/i18n/ru.ts`                                          |

Data flow for a local change:

```text
Renderer action (send, branch, status, title, mark read)
  -> IPC (validated)
  -> DocumentSession: existing domain function changes DocumentContents; file is saved as today
  -> Sync service: builds the event from the change
  -> Crypto: sign once; encrypt once per other participant
  -> FolderTransport: write one file into each recipient's inbox
```

Data flow for an incoming event:

```text
FolderTransport (watch + scan) -> Sync service: read, size check
  -> Crypto: decrypt, verify signature
  -> Replay and membership checks
  -> src/shared/sync apply rules -> DocumentSession (open window) or document file (no window)
  -> Delivery receipt to the sender -> delete own inbox file
```

---

## 6. BranchChat file in a synchronized discussion

### 6.1 Role of the file **[Pending Q-01, Q-02]**

Proposal:

- The local `.branchchat` file is the local, materialized view of the discussion. It stays in plain text, as today.
- The local file must not be in the shared folder. The wizard checks this and refuses a path inside the shared folder.
- Only encrypted files go into the shared folder.
- The conversation ID is the existing `manifest.documentId`.

### 6.2 New data in the file **[Pending Q-03, Q-13]**

A synchronized discussion needs this shared data:

- Sync marker: the discussion is synchronized (so the app knows to emit events).
- Member roster: `participantId`, display name, Ed25519 public signing key, X25519 public encryption key, key
  fingerprint, and the participant who added the member.
- Ordering data per message and per branch-status/title change (Q-05).

Option A: put this data in new optional fields. `passthrough` keeps them. Old app versions open the file but ignore
the sync data. No `schemaVersion` change.

Option B: put this data in a new ZIP entry `sync.json`. Old versions copy the entry through unchanged.

Option C: increase `schemaVersion` to 2. Old versions refuse the file.

Private keys, local paths, and local sync state are never stored in the file.

---

## 7. Participants, identity, and membership

### 7.1 Identity **[Pending Q-14, Q-15]**

Proposal:

- One identity per Windows user (per installation), bound to the existing `participantId` in `settings.json`.
- The identity has an Ed25519 signing key pair and an X25519 encryption key pair.
- The fingerprint is a short hash of both public keys, shown in groups of characters.
- Private keys are stored with `safeStorage` in the user data folder. They are never logged, never sent to the
  renderer, never written to a discussion file or the shared folder.

### 7.2 Membership rules (v1)

- The initiator creates the synchronized discussion and adds the first members.
- After that, all participants are equal. There is no administrator.
- New members can join after the discussion is active. **[Pending Q-13]** decides who can add a member.
- Nobody can leave. Nobody can remove another participant.
- Folder access alone does not make a person a member. A person becomes a member only when an existing member
  accepts that person's public key.

### 7.3 Key loss and rejoin **[Pending Q-15]**

- No key backup in v1.
- A person who loses the private keys creates a new identity and joins again by invitation.
- Old events encrypted to the old key cannot be decrypted with the new key. The local `.branchchat` file still shows
  old messages, because the file is plain text.
- If the person also lost the local `.branchchat` file, the invitation must carry the full current discussion
  (Section 11).

---

## 8. Events

### 8.1 Event types **[Pending Q-04]**

One event type for each change in Section 2.3:

| Event               | Payload                                                                                  |
|---------------------|------------------------------------------------------------------------------------------|
| `message.sent`      | Full message (as in `discussion.json`, without `sequence`), plus new image assets (Q-10) |
| `branch.created`    | Full thread without messages                                                             |
| `branch.status.set` | `threadId`, `status`                                                                     |
| `branch.title.set`  | `threadId`, `title` (empty = remove)                                                     |
| `readstate.added`   | List of `messageId` that the sender has now read                                         |
| `member.added`      | Roster entry of the new member (Q-13)                                                    |
| `profile.updated`   | New display name (only if Q-12 allows name changes)                                      |
| `receipt.delivered` | Original event ID (transport only, not stored in the file)                               |

There are no edit or delete events.

### 8.2 Envelope fields

Every event has: protocol version, event ID (random), conversation ID (`documentId`), sender ID, per-sender sequence
number (1, 2, 3, … with no gaps), logical clock (Lamport), event type, payload, creation time (display only).

Each recipient copy also has the recipient ID. The signature covers all of these fields.

### 8.3 Ordering **[Pending Q-05]**

The current rule is "append order in the local file". With concurrent senders, each computer can get a different
order. Q-05 decides between:

- **Arrival order:** each computer appends messages in the order it receives them. Simple. Copies show a different
  order.
- **Deterministic order:** each message carries a Lamport clock. All computers sort by (clock, author ID, message
  ID). Copies converge. A late message from an offline participant can appear above messages that the reader has
  already seen.

In both options, the app recomputes `sequence` so the integrity rule (sequence = index) stays true.

### 8.4 Dependencies **[Pending Q-07]**

An event can depend on data that has not arrived yet. Examples: a message in a branch that does not exist yet; a
branch whose source message has not arrived. Proposal: keep the event in a local pending queue. Apply it when the
dependency arrives. Do not send the delivery receipt until the event is applied.

### 8.5 Concurrent changes **[Pending Q-06, Q-07]**

| Data          | Merge rule (proposal)                               |
|---------------|-----------------------------------------------------|
| Messages      | Union by `messageId`. Messages are immutable        |
| Branches      | Union by `threadId`                                 |
| Branch status | Last writer wins by (Lamport clock, participant ID) |
| Branch title  | Last writer wins by (Lamport clock, participant ID) |
| Read state    | Union per participant (read state only grows)       |
| Assets        | Union by SHA-256                                    |
| Roster        | Union by `participantId` (Q-13)                     |

A message for a branch that is closed on the receiving computer: see Q-07.

---

## 9. Changes to the document session

- A session for a synchronized discussion must accept remote events while the window is open. The window updates
  through the existing `documentChanged` message.
- Remote events go through the same write queue as local changes, so a local save never overwrites a remote change.
- If no window shows the discussion, the sync service applies events directly to the file. **[Pending Q-16]**
- Unread highlighting, the window-title count, and the side-panel counts work on remote messages without change.
- FR-117 (two copies with the same `documentId`) stays. For a synchronized discussion, the sync service writes only
  to the file path in the sync registry.

---

## 10. Cryptography

### 10.1 Construction

- libsodium (`libsodium-wrappers-sumo` or `libsodium-wrappers`; select during the plan).
- Sign the canonical serialization of the event with Ed25519.
- Put the event and the signature in a plain envelope. Encrypt the envelope for each recipient with
  `crypto_box_seal` (sealed box) to the recipient's X25519 public key.
- The recipient decrypts, then verifies the signature with the sender's public key from the roster.
- Successful decryption is not proof of the sender. Always verify the signature.
- Canonical serialization: define one rule (for example sorted keys, UTF-8, no spaces) and add test vectors.

### 10.2 Limits

- No forward secrecy. If a long-term private key leaks, all events encrypted to it can be decrypted.
- Sealed boxes need the full payload in memory. Large images make this expensive. **[Pending Q-10]**
- Replay protection: track processed event IDs and the per-sender sequence number locally.

---

## 11. Invitations and onboarding

### 11.1 Public-key bundle

A bundle contains: `participantId`, display name, public signing key, public encryption key, fingerprint, protocol
version. It is not secret. **[Pending Q-21]** decides how users exchange it.

### 11.2 Invitation

- An invitation is encrypted to the invitee's public encryption key and signed by the inviting member.
- It contains: the conversation ID, the roster with public keys, and the current discussion (the full
  `DocumentContents` plus image assets).
- The invitee checks the signature and the fingerprint of the inviting member, creates a local `.branchchat` file
  from the invitation, and starts sync.

### 11.3 Create-discussion wizard **[Pending Q-20]**

Steps:

1. Explain what a synchronized discussion is and what the sync provider can still see.
2. Create the identity if it does not exist. Show the fingerprint. Explain that private keys stay on this computer
   and that key loss means rejoining.
3. Select or create the local `.branchchat` file (outside the shared folder). An existing discussion can become
   synchronized. **[Pending Q-02]**
4. Explain how to create and share a folder in the sync product (for example Google Drive for Desktop), and how to
   make it available offline.
5. Select the local path of the shared folder. Run a write, read, and delete test in a test subfolder.
6. Publish own public-key bundle. Collect the bundles of the other people.
7. Review each candidate: name and fingerprint. Accept or discard.
8. Send invitations. Show the roster and the state of each invitee.

### 11.4 Join wizard

1. Create the identity if it does not exist. Publish the public-key bundle.
2. Select the local path of the shared folder. Run the folder test.
3. Wait for the invitation. Check the inviter's fingerprint.
4. Select where to save the local `.branchchat` file.
5. Import the discussion and start sync.

### 11.5 Activation **[Pending Q-22]**

Proposal: the discussion is active for a member when that member has imported the invitation. The initiator sees
each invitee as "invited", "joined" (delivery receipt for the invitation received), or "not reachable".

---

## 12. Shared-folder layout **[Pending Q-19]**

```text
<shared root>/
  branchchat-sync.json            protocol version and conversation ID only (no names, no content)
  keys/<participantId>.bckey      public-key bundles
  inbox/<participantId>/          one folder per member
    <eventId>.bcmsg               encrypted event for this member
    <eventId>.bcrcpt              encrypted receipt for this member
    <invitationId>.bcinv          encrypted invitation for this member
  .test/<random>.tmp              folder test, deleted after the test
```

- File names use random IDs only.
- Never write plain text, private keys, local databases, logs, or decrypted images into the shared folder.
- A sender writes into the inbox of each other member. A recipient deletes only files in its own inbox.
- Write a file under a temporary name in the same folder, then rename it. Ignore `.tmp` files.

---

## 13. Outgoing flow

1. The user makes a change. The existing domain function changes the local discussion. The file is saved as today.
2. The sync service builds the event and assigns the event ID and the next sender sequence number.
3. The crypto module signs the event once and encrypts it once per recipient.
4. The sync service records the event and each recipient copy in the local outbox.
5. The transport writes each copy with temp-file-then-rename into the recipient's inbox.
6. The sync service marks each recipient copy as "written".
7. On partial failure, retry only the missing copies. Never create a new event ID for a retry.
8. If no delivery receipt arrives after a time, write the same copy again. **[Pending Q-09]**

---

## 14. Incoming flow

1. A watcher event or a scan finds a file in the own inbox.
2. Wait until the file size is stable. Check the size limit (Q-10).
3. Decrypt. Verify the signature. Check conversation ID, recipient ID, sender in roster, event ID, and sequence.
4. If the event was already applied: skip step 5.
5. Apply the event (Section 8). If a dependency is missing, put the event in the pending queue and stop here.
6. Save the local file and the local sync state.
7. Write `receipt.delivered` into the sender's inbox.
8. Delete the processed file from the own inbox.
9. After a crash between steps 6 and 8, the next scan finds the file, sees the event as applied, and completes
   steps 7 and 8.

Invalid files: move a record to a local quarantine list (not in the shared folder). Do not delete another member's
files. Log only safe error codes.

---

## 15. Delivery and read state

### 15.1 Delivery **[Pending Q-09]**

Proposal: delivery state is local to the sender. It is stored in the local sync state, not in the `.branchchat` file.

| Mark            | Meaning                                                                     |
|-----------------|-----------------------------------------------------------------------------|
| One grey check  | The encrypted file is written to the local shared folder for all recipients |
| Two grey checks | All recipients sent a valid delivery receipt                                |
| Read (see 15.2) | All recipients have the message in their read state                         |

The one grey check does not mean that the file reached the cloud.

### 15.2 Read **[Pending Q-08]**

Proposal: keep the existing read model. Do not add a "read on display" rule.

- When the local read state grows, the app sends `readstate.added` to all members, not only to the author.
- The existing "who has read" indicator (FR-122, FR-123) then works across computers.
- The existing three-state indicator is the read mark. A separate green checkmark is not added. Q-08 decides.

### 15.3 Group details

The message details show, per member: written, delivered, read.

---

## 16. Watching and scanning

- Use `fs.watch` or Chokidar for fast notice. **[Pending Q-17]** (dependency choice).
- Watch events are an optimization only. Do full scans: at start, when the folder becomes available again, after
  watcher errors, periodically, and on user request ("Проверить папку" action).
- Handle duplicates and sync-product conflict copies (for example `name (1).bcmsg`). Deduplicate by authenticated
  event ID plus recipient ID, never by file name.

---

## 17. Local sync state **[Pending Q-17]**

Per synchronized discussion, in the user data folder:

- Outbox: event ID, recipient ID, written / delivered / read, retry time.
- Processed events: event ID, sender, sender sequence.
- Pending queue: events that wait for a dependency.
- Peer state: last sender sequence, roster version.
- Quarantine list and last scan time.

Global sync registry: `documentId`, local file path, shared folder path.

Never put this state in the shared folder. Never sync a live database.

---

## 18. Google Drive for Desktop (guidance only)

The application treats Google Drive for Desktop as one sync product that exposes a folder. It has no Drive-specific
code, unless Q-18 decides otherwise.

The wizard and the user guide must explain:

- Drive for Desktop has two modes: streaming and mirroring.
  [Stream and mirror files](https://support.google.com/drive/answer/13401938),
  [Open files offline](https://support.google.com/drive/answer/16631477).
- In streaming mode, mark the shared folder "Available offline". Verify that this also applies to new files.
- A folder shared from another person's My Drive may need a shortcut in your own My Drive before it appears locally.
  Verify this during testing.
- Streamed files can be unavailable when Drive for Desktop is closed or signed out.
- The folder path and access are checked again at each start.

Test matrix: current stable Drive for Desktop on Windows; streaming with offline pinning; streaming without pinning;
mirroring; Drive paused, signed out, restarted, updated; permission removed and restored.

---

## 19. Security

- Keep the existing Electron settings (context isolation, sandbox, narrow preload, CSP, IPC validation).
- Crypto, keys, and file access stay in the main process or a utility process.
- Treat every file in the shared folder as untrusted. Validate events with zod schemas, as `.branchchat` files are
  validated today.
- Restrict all transport paths to the configured shared root. Refuse path traversal and links.
- Never log keys, plain text, or decrypted payloads.
- Get a security review of the crypto code before release.

Protected: sync provider reading content; changed events; forged events from a member whose key is not compromised;
duplicate messages from duplicate files.

Not protected: compromised endpoint; participant who shares plain text; leaked private key; metadata analysis; files
deleted, held back, or damaged by the provider or by a person with folder access; quota or permission denial of
service.

---

## 20. Testing plan

### Functional

- Create, join, and use a synchronized discussion with 2 and with 3 participants.
- Each event type in Section 8.1 reaches all members and gives the same result on each computer (as Q-05 defines).
- Branch, nested branch, branch close/reopen, branch title, images, read state, and "who has read" work across
  computers.
- A non-synchronized discussion behaves exactly as before. Existing unit and e2e tests pass.
- Old app version opens (or refuses, per Q-03) a file from a synchronized discussion without damage.
- Key loss: new identity, new invitation, future messages arrive; old ciphertext cannot be decrypted.
- No leave, remove, edit, or delete controls exist.

### Offline and sync

- Recipient offline; one group member offline; sender offline before sync; all offline.
- Drive paused, restarted, signed out; folder unavailable; drive letter changed; permission removed and restored.
- Delayed, reordered, duplicated, and conflict-copy files.
- Concurrent messages in the same thread; concurrent branch status changes; a message to a branch closed by another
  member.

### Reliability

- Stop the app during a write; after apply but before receipt; after receipt but before delete.
- Partial group send. Missed watcher events. Windows restart.

### Security

- Changed ciphertext, changed signed fields, replayed events, unknown sender, discarded candidate key.
- Malformed and very large files. Hostile file names and path traversal.
- No private key or plain text in the shared folder or logs.

---

## 21. Open questions

Write your answer after **Answer:**. A recommendation is only a proposal.

### A. BranchChat file and format

**Q-01. Where does the plain-text `.branchchat` file live in a synchronized discussion?**  
The file contains the full history in plain text. If it is in the shared folder, or if users share it through the sync
product, the encryption has no value.  
Options: (a) Local only, outside the shared folder; the app refuses a path inside it. (b) Allowed in the shared
folder; encryption protects only the event files. (c) Encrypt the full `.branchchat` file at rest.  
Recommendation: (a).  
**Answer:** Local only, outside the shared folder.(a).

**Q-02. Can an existing (non-synchronized) discussion become synchronized?**  
Options: (a) Yes; the wizard converts it, and the full history goes to members inside the invitations. (b) No; only
new discussions can be synchronized.  
Recommendation: (a).  
**Answer:** (a)

**Q-03. How do we store the new shared data (sync marker, roster, public keys, ordering data)?**  
Options: (A) New optional fields, no version change; old app versions open the file and can still add messages, but
those changes are not sent as events. (B) New ZIP entry `sync.json`, no version change; same effect as (A).
(C) `schemaVersion` 2; old versions refuse the file.  
Recommendation: (C). It prevents an old version from silently changing a synchronized file. The release must ship
before users create synchronized discussions.  
**Answer:** (c)

### B. Events and merging

**Q-04. Must all six kinds of change (Section 2.3) be synchronized?**  
Revision 1 had only `message.sent`. Without the others, branches, branch status, titles, and read state differ on each
computer.  
Recommendation: yes, all of them.  
**Answer:** yes, all of them

**Q-05. Message order in a thread when two people write at the same time.**  
Options: (a) Arrival order on each computer (copies can differ). (b) Deterministic order by Lamport clock (copies
converge; a late message can appear above messages that the reader already saw, and stays highlighted as unread).  
Recommendation: (b).  
**Answer:** (b)

**Q-06. Manual file sharing in a synchronized discussion.**  
Revision 1 said that any participant may share the local file. Today the app does not merge copies (FR-117 warns
only).  
Options: (a) Not supported for synchronized discussions; the invitation carries the state. (b) Add "Import copy":
merge by IDs (Section 8.5 rules). (c) Replace the local file with the received file.  
Recommendation: (a) for v1. Invitations already cover "send the current state to a person".  
**Answer:** Since users still can opt out of Google Drive sync - i.e. use the old way of sharing file manually it only
makes sense if this thing also works for synchronized discussion. No merge required. Opening such a file behaves same as
previously. The shared file in that case does not become syncrhonized automatically. It is detached. the only way to
share file with google syncrhonization is to use invitation.

**Q-07. A remote message arrives for a branch that is closed on this computer.**  
Today a closed branch refuses new messages.  
Options: (a) Accept the message; the branch stays closed. (b) Accept the message and reopen the branch. (c) Refuse
the message (it is then lost for this member).  
Also: branch status and title use "last writer wins" (Section 8.5). Do you agree?  
Recommendation: (a), and yes to "last writer wins".  
**Answer:** (a)

### C. Receipts and status

**Q-08. Read status: keep the existing model?**  
Today: read only by explicit action or reply (FR-112); read state is visible to all members (FR-122). Revision 1:
read when displayed; receipt to the author only; green checkmarks.  
Options: (a) Keep the existing model; send read-state changes to all members; the existing three-state indicator is the
read mark. (b) Add green checkmarks next to the existing indicator, with the existing read rules. (c) Change the read
rule to "read when displayed".  
Recommendation: (a).  
**Answer:** (a)

**Q-09. Sent and delivered marks.**  
Options: (a) Add one grey check (written) and two grey checks (delivered by all), stored only on the sender's
computer. (b) Do not add them in v1.  
Also: how long before an unconfirmed copy is written again? Recommendation: at each start and each 30 minutes.  
Recommendation: (a).  
**Answer:** (a). Also - unconfirmed copy is written again - at each start and each 30 minutes provided there is any other activity from same recepient in that timeframe. If no such activity - do not retry.

### D. Images and limits

**Q-10. How do images reach other members, and is there a size limit?**  
Images are in the ZIP today. Other members need the bytes. NFR-015 says "no limits". Sealed boxes need the full
payload in memory; one very large file per recipient is slow to sync.  
Options: (a) Image bytes inside the `message.sent` event, no limit. (b) Image bytes inside the event, with a limit per
event (for example 25 MB) for synchronized discussions only. (c) Separate encrypted asset files, split into chunks,
no limit.  
Recommendation: (b) for v1.  
**Answer:** Image is sent separately - as a separate event. User sees placeholder during download - i.e. message.sent event hold information about the upcoming image. No size limit.

**Q-11. Size limit for event files in general (protection against hostile files).**  
Recommendation: refuse any shared-folder file larger than the image limit in Q-10 plus 1 MB.  
**Answer:** 30mb, configurable in settings.

### E. Participants and identity

**Q-12. Display-name change in a synchronized discussion.**  
Settings allows a name change today (FR-138). Revision 1 said "no display-name change after creation".  
Options: (a) Allowed; send `profile.updated`; old messages keep the old name (as today). (b) Not allowed for
synchronized discussions.  
Recommendation: (a).  
**Answer:** (a)

**Q-13. Who can add a new member after the discussion is active, and how do others accept the new member?**  
Options: (a) Any member can invite; others accept the new member automatically because a valid member signed
`member.added`. (b) Any member can invite; each other member must confirm the new member's fingerprint. (c) Only the
initiator can invite.  
Also: are invited members shown in the "who has read" indicator before their first write? Today a person is shown
only after the first write (FR-124).  
Recommendation: (a), and yes, show members from the roster.  
**Answer:** (a)

**Q-14. One identity per computer user, or one identity per discussion?**  
Today there is one `participantId` per Windows user.  
Options: (a) One key pair per Windows user, bound to the existing `participantId`. (b) A new key pair for each
discussion.  
Recommendation: (a).  
**Answer:** (a)

**Q-15. Rejoin after key loss: how does the person keep the same participant ID?**  
If `settings.json` is lost, the `participantId` is also lost (FR-020). Revision 1 says that a returning participant
keeps the ID.  
Options: (a) The person gets a new participant ID and appears as a new member (simple; old messages show the old
identity). (b) A member re-invites the person with the old participant ID; members accept the new keys for that ID
after a fingerprint check. (c) Add an export of the participant ID (not the keys) in Settings.  
Recommendation: (a) for v1.  
**Answer:** (b)

### F. Application behavior

**Q-16. Must sync run when no discussion window is open?**  
Today the app quits when the last window closes.  
Options: (a) Sync only for discussions that are open in a window. (b) Sync all registered discussions while any
window is open. (c) Keep the app running in the notification area (tray) after the last window closes, with an option
to start with Windows.  
Recommendation: (b) for v1; (c) later.  
**Answer:** (c)

**Q-17. Dependencies for local state and file watching.**  
Options for local state: (a) JSON files with the existing atomic write. (b) SQLite (native module; needs a rebuild
for Electron and more packaging work).  
Options for watching: (a) Node `fs.watch` plus scans. (b) Chokidar.  
Recommendation: JSON and Chokidar.  
**Answer:** JSON and Chokidar

**Q-18. Transport options in v1.**  
"Local-only mode with manual file exchange" is the existing behavior of non-synchronized discussions. A Google Drive
adapter would contain the same code as a folder adapter.  
Proposal: v1 has one transport, "shared folder". Google Drive for Desktop is covered by wizard text and tests only. No
separate local-only sync mode.  
**Answer:** as proposed

**Q-19. Which Google Drive sharing setup is the target?**  
In a folder in a personal My Drive, an editor may not be able to delete files that another account owns. Then the
recipient cannot delete its inbox files. In a shared drive (Google Workspace), members with "Content manager" can
delete.  
Options: (a) Personal My Drive folder shared with Editor rights. (b) Shared drive. (c) Both.  
If deletion is not possible: (i) the recipient leaves the file and records it as processed; the sender deletes its own
files after the delivery receipt arrives; (ii) other.  
Recommendation: (c), with (i) as the cleanup rule, because the owner of a file can always delete it. Verify with a
test before the plan.  
**Answer:** as recommended

**Q-20. Menu location and names of the wizards.**  
The menu has File, Edit, Help. Proposal: File > "Новое общее обсуждение…", File > "Присоединиться к обсуждению…", and
for an open discussion File > "Сделать обсуждение общим…".  
**Answer:** ok

**Q-21. How do people exchange public-key bundles before the invitation?**  
Options: (a) Through the shared folder only (`keys/`); the initiator checks fingerprints by phone or in person.
(b) Also as a file or text that users copy (for example through WhatsApp). (c) Both.  
Recommendation: (c).  
**Answer:** (c)

**Q-22. When is the discussion "active"?**  
Revision 1: "when every participant can read the messages".  
Options: (a) Active for each member as soon as that member has imported the invitation; others can already write.
(b) Nobody can write until all invited people have joined.  
Recommendation: (a).  
**Answer:** (a)

**Q-23. Delivery of messages written before a person joined.**  
With option (a) of Q-22, messages can be written after an invitation is created but before the invitee joins.  
Proposal: the invitee is in the roster from the invitation; senders already write copies to the invitee's inbox. The
invitee processes them after the import. Do you agree?  
**Answer:** ok

---

## 22. Settled decisions (from revision 1, still valid)

1. No server, no Google API, no OAuth.
2. libsodium sealed boxes per recipient plus Ed25519 signatures. Test vectors and a security review before release.
3. No forward secrecy in v1. Document the limit.
4. No key backup in v1.
5. No leave, no remove, no edit, no delete in v1.
6. After creation, all participants are equal. No administrator.
7. Folder access is not identity. The initiator can discard a candidate key.
8. Invitations are encrypted to the invitee's public key. No extra channel is needed for confidentiality.
9. Each recipient deletes only files in its own inbox (subject to Q-19).
10. The transport is behind an interface. Conversation logic does not depend on Google Drive or on the watcher library.
11. No new attachment types.

---

## 23. Milestones (draft; final plan after the answers)

1. **Requirements and format.** New revision of `requirements.md` and ADR. Event schemas (zod). Format change per Q-03.
2. **Pure sync core (`src/shared/sync/`).** Apply rules, ordering, merge rules, dependency queue. Unit tests only.
3. **Crypto and keys.** libsodium, `safeStorage` key store, canonical serialization, test vectors.
4. **Folder transport and sync service.** Temp-then-rename writes, watch and scan, outbox, receipts, cleanup, local
   state, crash recovery.
5. **Session integration.** Events from local changes; remote events into open sessions and closed files.
6. **Wizards and UI.** Create, join, convert; roster; delivery marks; per-member details; Russian strings.
7. **Hardening.** Failure injection, security tests, Drive for Desktop test matrix, user guide (Russian), security
   review.

---

## Appendix A. Cautions

- Google Drive for Desktop is a file sync client, not a messaging system. Its timing is not guaranteed.
- Never assume that a local file has reached the cloud.
- Never depend only on watcher events.
- Never change an event file after it is written.
- Never treat folder membership as authentication.
- Never put private keys, plain text, or local state in the shared folder.
- Never delete a file in another member's inbox.
- Never invent a cryptographic protocol. Use the libsodium constructions as documented.

## Changes in revision 2

- Added the facts from the current code (Section 2) and the list of conflicts (Section 3).
- Corrected the description of the read state and of the file format.
- Added events for all existing changes, ordering, dependency, and merge rules.
- Mapped components to the code structure. Removed the separate Google Drive adapter and local-only mode (pending
  Q-18).
- Moved all open questions to Section 21, with options and recommendations.
