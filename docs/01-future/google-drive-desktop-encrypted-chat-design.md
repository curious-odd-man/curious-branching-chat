# Design: Encrypted Synchronized BranchChat Discussions over a Shared Folder

**Status:** Draft, revision 5 (answers Q-01 to Q-38 included; one open question in Section 22)  
**Platform:** Windows 10 and Windows 11 (same as the MVP)  
**Transport model:** A shared local folder that a sync product (for example Google Drive for Desktop) keeps in sync  
**Backend:** None  
**Google integration:** None. No Drive API, no OAuth, no Google credentials in the application.

---

## 0. How to use this document

- Section 2 records facts from the current code. These facts are the baseline for this design.
- Section 3 lists the conflicts between revision 1 and the code, and how each conflict is resolved.
- Section 4 records all decisions (answers Q-01 to Q-38).
- Sections 5 to 21 give the design. Text marked **[Pending Q-nn]** depends on an open question.
- Section 22 contains the new open questions. Write your answer on the **Answer:** line.
- Section 23 lists tests that must be done before the release with sync. Their results are assumed for now.
- The implementation plan is `google-drive-sync-implementation-plan.md`.

---

## 1. Overview

BranchChat today stores one discussion in one `.branchchat` file. Users exchange the full file manually (for example
through WhatsApp). The application does not merge copies.

This feature adds a second way to share a discussion: a **synchronized discussion**. In a synchronized discussion:

- Each participant keeps a local `.branchchat` file, outside the shared folder.
- Each local change becomes an **event**. The application signs the event and encrypts it separately for each other
  participant.
- The application writes the encrypted events into a shared folder. A sync product (for example Google Drive for
  Desktop) moves the files between computers. The application does not know which sync product it is.
- Each participant applies the incoming events to its local `.branchchat` file.
- The application runs in the notification area (tray), so sync continues when all windows are closed.

The sync product is untrusted and eventually consistent. Files can arrive late, more than once, or in a different
order. The sync product must not see message content.

Manual file exchange continues to work. A copy of a synchronized discussion that a person sends manually is
**detached**: it opens as a normal discussion and is not synchronized. The only way to join a synchronized discussion
is an invitation.

There are no users of the application yet. Backward compatibility with version 1.0 files and with version 1.0 of the
application is not required.

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
- An asset that is listed in `assets[]` but has no bytes in the ZIP is shown as a placeholder (FR-075). The file still
  opens.

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
- A downloaded update installs silently when the application closes normally (FR-141).

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
- Current dependencies do not include Chokidar or libsodium.
- Out of scope in the MVP requirements: real-time sync, cloud storage, merging copies, cryptographic identity. This
  feature changes these decisions. The requirements document must get a new revision.

---

## 3. Conflicts between revision 1 and the code, and their resolution

| #   | Revision 1 assumption                              | Current code                             | Resolution                                                       |
|-----|----------------------------------------------------|------------------------------------------|------------------------------------------------------------------|
| C1  | The BranchChat file is shared                      | The file is plain text                   | File stays local (D-01)                                          |
| C2  | Only `message.sent` events                         | Six kinds of change                      | All changes are events (D-04)                                    |
| C3  | Order by event metadata                            | `sequence` = local index                 | Deterministic Lamport order (D-05)                               |
| C4  | Read when displayed; green checkmarks              | Read by explicit action; visible to all  | Existing model kept (D-08)                                       |
| C5  | Sent / delivered checkmarks                        | No such state                            | Added, local to sender (D-09)                                    |
| C6  | Image handling unchanged                           | Images are inside the ZIP                | Images travel as separate parts (D-10, D-30)                     |
| C7  | File-size limits                                   | NFR-015: no limits                       | 30 MB per file, configurable; large messages split (D-11, D-30)  |
| C8  | No display-name change                             | Settings allows it                       | Allowed, `profile.updated` (D-12)                                |
| C9  | Roster from invitations                            | Participant appears after first write    | Roster members are known participants (D-13, D-25)               |
| C10 | Per-conversation identity; returning user keeps ID | One `participantId` per Windows user     | One identity per user (D-14); re-invite with old ID (D-15, D-32) |
| C11 | Continuous processing                              | App quits with the last window           | Tray (D-16, D-33)                                                |
| C12 | Incoming changes update the conversation           | Session does not accept external changes | Section 10                                                       |
| C13 | Any participant may share the file                 | No merge                                 | Manual copy is detached (D-06, D-26, D-27)                       |
| C14 | Remote messages always apply                       | Closed branch refuses messages           | Accept; branch stays closed (D-07)                               |
| C15 | SQLite                                             | JSON with atomic writes                  | JSON (D-17)                                                      |
| C16 | Preserve the format                                | Old versions refuse newer schema         | All files use `schemaVersion` 2 (D-03, D-28)                     |
| C17 | Recipient deletes inbox files                      | Files belong to the sender's account     | Cleanup rule (D-19, D-34)                                        |
| C18 | Several adapters, local-only mode                  | Manual exchange is the existing behavior | One folder transport (D-18)                                      |
| C19 | Menu "Chat → New chat"                             | Menu has File, Edit, Help                | File menu items (D-20)                                           |

---

## 4. Decisions

| ID   | Topic                       | Decision                                                                                                                                                                                                                                                                                                                                                                        |
|------|-----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| D-01 | Local file location         | The `.branchchat` file is local only, outside the shared folder. The app refuses a path inside the shared folder                                                                                                                                                                                                                                                                |
| D-02 | Convert existing discussion | Yes. The wizard converts it. The full history goes to members inside the invitations                                                                                                                                                                                                                                                                                            |
| D-03 | Format                      | `schemaVersion` 2. Version 1.0 of the app refuses the file                                                                                                                                                                                                                                                                                                                      |
| D-04 | Events                      | All kinds of change are synchronized                                                                                                                                                                                                                                                                                                                                            |
| D-05 | Message order               | Deterministic order by Lamport clock. Copies converge                                                                                                                                                                                                                                                                                                                           |
| D-06 | Manual file sharing         | Still possible. A manually shared copy opens as before, with no merge. It is detached (not synchronized). Joining is only by invitation                                                                                                                                                                                                                                         |
| D-07 | Message for a closed branch | Accept the message. The branch stays closed                                                                                                                                                                                                                                                                                                                                     |
| D-08 | Read status                 | Keep the existing read model. Send read-state changes to all members. The existing three-state indicator is the read mark                                                                                                                                                                                                                                                       |
| D-09 | Sent / delivered marks      | One grey check (written), two grey checks (delivered by all), stored on the sender's computer only                                                                                                                                                                                                                                                                              |
| D-10 | Images                      | Images travel separately from the message header. The recipient sees a placeholder until the image arrives. No image size limit                                                                                                                                                                                                                                                 |
| D-11 | File size limit             | 30 MB per shared-folder file. Configurable in Settings                                                                                                                                                                                                                                                                                                                          |
| D-12 | Display-name change         | Allowed. Send `profile.updated`. Old messages keep the old name                                                                                                                                                                                                                                                                                                                 |
| D-13 | Adding members              | Any member can invite. Others accept the new member automatically, because a valid member signed `member.added`                                                                                                                                                                                                                                                                 |
| D-14 | Identity                    | One key pair per Windows user, bound to the existing `participantId`                                                                                                                                                                                                                                                                                                            |
| D-15 | Rejoin after key loss       | A member re-invites the person with the old participant ID. Other members accept the new keys after a fingerprint check                                                                                                                                                                                                                                                         |
| D-16 | Background sync             | The app stays in the tray after the last window closes. Option to start with Windows                                                                                                                                                                                                                                                                                            |
| D-17 | Dependencies                | Local state in JSON files with the existing atomic write. Chokidar for watching                                                                                                                                                                                                                                                                                                 |
| D-18 | Transports                  | One transport: "shared folder". Google Drive for Desktop is covered by wizard text and tests only. No local-only sync mode                                                                                                                                                                                                                                                      |
| D-19 | Drive setup and cleanup     | Support personal My Drive folders and shared drives. The owner of an inbox deletes processed files in it. If a delete fails, it records the file as processed; the sender deletes its own files after the delivery receipt                                                                                                                                                      |
| D-20 | Menu                        | File > "Новое общее обсуждение…", File > "Присоединиться к обсуждению…", File > "Сделать обсуждение общим…" (open discussion)                                                                                                                                                                                                                                                   |
| D-21 | Public-key bundle exchange  | Both: through the shared folder (`keys/`) and as a file or text that users copy                                                                                                                                                                                                                                                                                                 |
| D-22 | Activation                  | Active for each member when that member has imported the invitation. Others can already write                                                                                                                                                                                                                                                                                   |
| D-23 | Messages before join        | The invitee is in the roster from the invitation. Senders write copies to the invitee's inbox. The invitee processes them after the import                                                                                                                                                                                                                                      |
| D-24 | Branch status and title     | Last writer wins by (Lamport clock, participant ID)                                                                                                                                                                                                                                                                                                                             |
| D-25 | Known participants          | All roster members are known participants for the read indicator, also before their first write                                                                                                                                                                                                                                                                                 |
| D-26 | Detached copy               | Keeps the same `documentId` (FR-117 warns if both are open). A copy made in Explorer keeps its sync data, which the app ignores. Action "Отправить копию…" saves a clean copy without sync data. Both stay version 2                                                                                                                                                            |
| D-27 | Moved or renamed file       | When a file with a registered `documentId` opens and the registered path is missing, the app asks "Это ваше общее обсуждение, которое было перемещено?". When the registered file is missing at start, the tray shows a warning and asks the person to find the file                                                                                                            |
| D-28 | Schema version of all files | The new app writes all files as version 2, also non-synchronized discussions. Version 1 files are migrated when opened                                                                                                                                                                                                                                                          |
| D-29 | Retry rule                  | At start and every 30 minutes, write an unconfirmed copy again only if a valid event or receipt from that recipient arrived since the last write of the copy. No maximum number of retries. Parts use the same rule                                                                                                                                                             |
| D-30 | Large messages              | A message that does not fit in one file is split into parts. `message.sent` comes first and lists all parts. The parts follow as separate files. The message is processed when all parts have arrived. The UI shows the message as loading: number of parts loaded, and the partial message where possible. Part size 4 MB. Size limit setting: 5 MB to 1 000 MB, default 30 MB |
| D-31 | Image placeholder           | Separate placeholder "Изображение загружается…" until the image arrives. The existing placeholder for missing or damaged data stays                                                                                                                                                                                                                                             |
| D-32 | Rejoin details              | The re-invitation sets the old ID as the global `participantId`. Events signed with keys that a member has not accepted wait in that member's pending queue. Nobody encrypts to unaccepted keys. A member who rejects the keys keeps the old keys; both sides see a warning                                                                                                     |
| D-33 | Tray details                | Stay in the tray only when at least one synchronized discussion exists. One-time notice on the first close to the tray. Windows notifications for new messages, with a setting (default on)                                                                                                                                                                                     |
| D-34 | Receipt file cleanup        | A receipt file that the inbox owner did not delete is deleted by its writer after 7 days. Own sent files that never got a receipt are deleted after 30 days                                                                                                                                                                                                                     |
| D-35 | Sync problem notices        | Status line in the discussion window and in the tray menu only. No Windows notification for sync problems or key change requests                                                                                                                                                                                                                                                |
| D-36 | Start with Windows          | On after the first synchronized discussion is created or joined. The wizard says so. The person can turn it off in Settings                                                                                                                                                                                                                                                     |
| D-37 | Loading or partial message  | Until it is processed: it cannot be marked read, it cannot be a branch source, it does not count as unread, and sending in the same thread does not mark it read. Its text can be selected and copied. When processed, it becomes unread as usual. The UI shows the loading clearly, with a progress bar (Section 9.4)                                                          |
| D-38 | Notification content        | Author, discussion name, and the first characters of the text. Setting "Показывать текст в уведомлениях" turns the text off **[Pending Q-39]**                                                                                                                                                                                                                                  |

Settled from revision 1, still valid:

1. No server, no Google API, no OAuth.
2. libsodium sealed boxes per recipient plus Ed25519 signatures. Test vectors and a security review before release.
3. No forward secrecy in v1. Document the limit.
4. No key backup in v1.
5. No leave, no remove, no message edit, no message delete, no branch delete in v1.
6. After creation, all participants are equal. No administrator.
7. Folder access is not identity. The initiator can discard a candidate key.
8. Invitations are encrypted to the invitee's public key. No extra channel is needed for confidentiality.
9. The transport is behind an interface. Conversation logic does not depend on Google Drive or on Chokidar.
10. No new attachment types.

---

## 5. Goals and non-goals

### Goals

- Synchronized discussions between two or more participants, through a shared folder.
- No server, no hosting cost, no Google API.
- End-to-end encryption and sender authentication for every event.
- Delivery to an offline participant after the sync product has moved the file.
- At-least-once delivery, idempotent processing, recovery from missed events, duplicates, and sync delays.
- All existing features work in a synchronized discussion: branches, nested branches, branch status and title, rich
  text, images, read state, "who has read" indicator, unread counts.
- Non-synchronized discussions keep their behavior (in the version 2 format).
- Manual exchange of a copy still works (detached copy).
- Wizards to create, convert, and join a synchronized discussion.
- Sync continues in the background (tray).

### Non-goals and limitations

- No compatibility with version 1.0 of the application (there are no users yet).
- No anonymity from the sync provider. The provider can see accounts, folder membership, file sizes, times, and
  traffic volume.
- No guarantee of immediate delivery. No way to know that a local file has reached the cloud.
- No protection against a participant who copies or shares plain text. A detached copy is plain text.
- No multi-device identity.
- No merge of a detached copy back into a synchronized discussion.
- No leave and no remove participant in v1.
- No forward secrecy in v1.
- No new attachment types.

---

## 6. Architecture (mapped to the code)

| Component                   | Location (proposed)                       | Notes                                                                               |
|-----------------------------|-------------------------------------------|-------------------------------------------------------------------------------------|
| Event model and apply rules | `src/shared/sync/`                        | Pure TypeScript. Applies an event to `DocumentContents`. Testable without Electron  |
| Existing domain             | `src/shared/domain/`                      | Reused. Local changes still go through the existing functions                       |
| Document file               | `src/main/document/`                      | Schema version 2 and migration from 1 to 2 (Section 7)                              |
| Document session            | `src/main/application/documentSession.ts` | Extended: emits an event for each local change; accepts remote events               |
| App lifecycle and tray      | `src/main/application/`                   | Tray icon; no quit when the last window closes; start with Windows; notifications   |
| Sync service                | `src/main/sync/`                          | Outbox, inbox processing, receipts, parts, scans, retries, cleanup                  |
| Cryptography                | `src/main/crypto/`                        | libsodium. Runs in the main process or a utility process. Never in the renderer     |
| Key store                   | `src/main/crypto/keyStore.ts`             | Private keys protected with Electron `safeStorage` (DPAPI on Windows)               |
| Transport                   | `src/main/transport/`                     | `FolderTransport`: the only transport in v1                                         |
| Local sync state            | User data folder, per discussion          | JSON files, atomic write. Never in the shared folder                                |
| Sync registry               | User data folder                          | List of synchronized discussions: `documentId`, local file path, shared folder path |
| Settings                    | `src/main/local-state/settings.ts`        | New: file size limit, start with Windows, notifications                             |
| Wizard UI                   | `src/renderer/components/sync/`           | Russian strings in `src/shared/i18n/ru.ts`                                          |

Data flow for a local change:

```text
Renderer action (send, branch, status, title, mark read)
  -> IPC (validated)
  -> DocumentSession: existing domain function changes DocumentContents; file is saved as today
  -> Sync service: builds the event (and its parts) from the change
  -> Crypto: sign once; encrypt once per other member
  -> FolderTransport: write the event file, then the part files, into each recipient's inbox
```

Data flow for an incoming event:

```text
FolderTransport (watch + scan) -> Sync service: read, size check
  -> Crypto: decrypt, verify signature
  -> Replay and membership checks
  -> Wait for all parts (if any) -> src/shared/sync apply rules
  -> DocumentSession (open window) or document file (no window)
  -> Delivery receipt to the sender -> delete own inbox file
```

---

## 7. BranchChat file

### 7.1 Role of the file

- The local `.branchchat` file is the local, materialized view of a synchronized discussion. It is plain text.
- The file must be outside the shared folder (D-01).
- The conversation ID is the existing `manifest.documentId`.
- The sync service writes only to the file path in the sync registry. Any other file with the same `documentId` is a
  detached copy (Section 7.4).

### 7.2 Schema version 2 (D-03, D-28)

- All files that the new app writes are version 2. A version 1 file is migrated when it is opened.
- Version 2 adds, for all files:
    - Per message: `clock` (Lamport) used for the order (Section 9.3).
    - Per thread: `clock` and participant ID of the last status change and of the last title change (D-24).
- Version 2 adds, for synchronized discussions only, a `sync` object (in `discussion.json` or a new ZIP entry
  `sync.json`; select during the plan):
    - `protocolVersion`.
    - `members[]`: `participantId`, display name, Ed25519 public signing key, X25519 public encryption key,
      fingerprint, `addedBy`, key history (Section 8.3).
- A non-synchronized discussion has no `sync` object. Its clocks follow the local order, so its behavior does not
  change.

Private keys, local paths, and local sync state are never stored in the file.

### 7.3 Migration and conversion (D-02, D-28)

- Migration 1 → 2 gives each existing message a clock that keeps the current order (for example, the clock is
  derived from the existing `sequence` and thread order).
- Conversion to a synchronized discussion adds the `sync` object.
- Existing participants who are not members stay in `participants[]`. They are authors of old messages only.
- The invitation carries the full history, including images (Section 12.2).

### 7.4 Detached copies (D-06, D-26, D-27)

- A person can copy the local file in Explorer and send it through WhatsApp, as today. That copy keeps its `sync`
  object.
- Action "Отправить копию…" saves a copy without the `sync` object. The copy is version 2 and keeps the same
  `documentId`.
- When the app opens a file with a `sync` object, and the sync registry on this computer does not map its
  `documentId` to that path, the file is a detached copy. The app ignores the `sync` object.
- Exception (D-27): if the `documentId` is registered and the registered path is missing, the app asks
  "Это ваше общее обсуждение, которое было перемещено?". "Да" updates the registry. "Нет" opens the file as detached.
- A detached copy behaves as a normal discussion: no events, no sync, no merge.
- The existing FR-117 warning applies when both copies are open on the same computer.

---

## 8. Participants, identity, and membership

### 8.1 Identity (D-14)

- One identity per Windows user, bound to the existing `participantId` in `settings.json`.
- The identity has an Ed25519 signing key pair and an X25519 encryption key pair.
- The fingerprint is a short hash of both public keys, shown in groups of characters.
- Private keys are stored with `safeStorage` in the user data folder. They are never logged, never sent to the
  renderer, never written to a discussion file or the shared folder.

### 8.2 Membership (D-13, D-22, D-23, D-25)

- The initiator creates the synchronized discussion and invites the first members.
- Any member can invite a new member. The inviting member sends a signed `member.added` event to all members. Other
  members accept the new member without a confirmation.
- The invitee is a member from the moment of the invitation. Senders write copies to the invitee's inbox. The invitee
  processes them after the import.
- All roster members are known participants for the read indicator, also before their first write. A new member shows
  as "not read" at once.
- Nobody can leave. Nobody can remove another participant.
- Folder access alone does not make a person a member.

### 8.3 Rejoin after key loss (D-15, D-32)

1. The person loses the private keys (and possibly `settings.json`). The app creates a new key pair.
2. The person publishes the new public-key bundle.
3. A member re-invites the person and states that the bundle replaces the keys of the old participant ID. The
   member sends a signed `member.keys.replaced` event (old participant ID, new public keys, new fingerprint).
4. Each other member's app shows a request in the status line: "Ключи <name> изменились. Сверьте отпечаток с этим
   человеком." The member accepts or rejects.
5. The re-invitation sets the old ID as the global `participantId` on the person's computer. The invitation carries
   the full current discussion.
6. Until a member accepts, events signed with the new keys wait in that member's pending queue, and that member does
   not encrypt to the new keys.
7. A member who rejects keeps the old keys for that person. The person gets no messages from that member. Both sides
   see a warning.
8. Old events encrypted to the old key cannot be decrypted with the new key. The invitation already contains the
   history in decrypted form, so the person sees all old messages.

Each member keeps the key history of each participant. Old signatures stay valid with the old keys.

---

## 9. Events

### 9.1 Event types (D-04)

| Event                  | Payload                                                                                                                                                                                                              |
|------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `message.sent`         | Message header: `messageId`, `threadId`, author, `clock`, `createdAt`. Content inline if it fits; otherwise listed as parts. List of images (`assetId` = SHA-256, media type, size). List of all parts (Section 9.4) |
| `message.part`         | `messageId`, part ID, part bytes (content or image data)                                                                                                                                                             |
| `branch.created`       | Full thread without messages                                                                                                                                                                                         |
| `branch.status.set`    | `threadId`, `status`                                                                                                                                                                                                 |
| `branch.title.set`     | `threadId`, `title` (empty = remove)                                                                                                                                                                                 |
| `readstate.added`      | List of `messageId` that the sender has now read                                                                                                                                                                     |
| `member.added`         | Roster entry of the new member                                                                                                                                                                                       |
| `member.keys.replaced` | Old participant ID, new public keys, new fingerprint                                                                                                                                                                 |
| `profile.updated`      | New display name                                                                                                                                                                                                     |
| `receipt.delivered`    | Original event ID or part ID (transport only, not stored in the file)                                                                                                                                                |
| `invitation`           | Section 12.2. Uses the same header-and-parts method when large                                                                                                                                                       |

There are no edit or delete events.

### 9.2 Envelope fields

Every event has: protocol version, event ID (random), conversation ID (`documentId`), sender ID, per-sender sequence
number (1, 2, 3, … with no gaps), Lamport clock, event type, payload, creation time (display only).

Each recipient copy also has the recipient ID. The signature covers all of these fields.

### 9.3 Ordering (D-05)

- Each message carries a Lamport clock. The sender sets it to one more than the highest clock it has seen.
- All computers sort the messages of a thread by (clock, author ID, message ID).
- After each insert, the app recomputes `sequence` so the integrity rule (sequence = index) stays true.
- A late message from an offline member can appear above messages that the reader already saw. It is highlighted as
  unread.
- This replaces "append order" (FR-026). In a non-synchronized discussion, the clocks follow the local order, so the
  visible order does not change.

### 9.4 Large messages and images (D-10, D-11, D-30, D-31)

- The part size is 4 MB. Each part is one encrypted file, so each file stays below the size limit.
- Each image is always sent as one or more parts (D-10). Message content is inline in `message.sent` if it fits in
  one file; otherwise it is sent as parts.
- `message.sent` comes first. It lists every part: part ID, kind (content or image), SHA-256, and size. The signature
  of `message.sent` covers this list, so it protects all parts.
- The recipient keeps the header in the local sync state and shows the message at its position as **loading**:
  "Сообщение загружается: 3 из 7 частей".
- Partial message: when the content is present but images are still on their way, the UI shows the text with the
  placeholder "Изображение загружается…" for each missing image (D-31).
- When all parts have arrived, the recipient checks each SHA-256, writes the message and the images into the local
  file, and sends the receipts. The message is then "processed".
- A part whose SHA-256 does not match is refused. The existing "damaged" placeholder shows if the part never arrives
  in a good state.
- An image that is already in the discussion (same SHA-256) is not sent again.
- Display of a loading message (D-37):
    - The message is a normal message bubble at its clock position, with the author and time from the header.
    - A progress bar shows the received parts and the received size, for example "Загружается: 3 из 7 частей
      (12 из 28 МБ)". The bar updates when each part arrives.
    - If the content has not arrived yet, the bubble shows a short grey placeholder line instead of the text.
    - The bubble has no read mark, no "Reply to this" action, and no unread highlight.
    - Each missing image shows "Изображение загружается…" with its own progress (parts of that image).
- Interaction with a loading or partial message (D-37): it cannot be marked read, it cannot be a branch source, it
  does not count as unread, and sending in the same thread does not mark it read. Its text can be selected and
  copied. When it is processed, it becomes unread as usual.

### 9.5 Dependencies

An event can depend on data that has not arrived yet (a message in an unknown branch, a branch whose source message
has not arrived or is still loading, a part of an unknown message). The event waits in a local pending queue. It is
applied when the dependency arrives. The delivery receipt is sent after the event is applied (for a part: after the
part is stored).

### 9.6 Concurrent changes

| Data          | Merge rule                                                 |
|---------------|------------------------------------------------------------|
| Messages      | Union by `messageId`; order by Section 9.3                 |
| Branches      | Union by `threadId`                                        |
| Branch status | Last writer wins by (Lamport clock, participant ID) (D-24) |
| Branch title  | Last writer wins by (Lamport clock, participant ID) (D-24) |
| Read state    | Union per participant (read state only grows)              |
| Assets        | Union by SHA-256                                           |
| Roster        | Union by `participantId`; key replacement per Section 8.3  |

A message for a branch that is closed on this computer is accepted. The branch stays closed (D-07).

---

## 10. Changes to the document session

- A session for a synchronized discussion accepts remote events while the window is open. The window updates through
  the existing `documentChanged` message.
- Remote events go through the same write queue as local changes, so a local save never overwrites a remote change.
- If no window shows the discussion, the sync service applies events directly to the file.
- The window also shows loading messages from the local sync state (Section 9.4). They are not in the file yet.
- Unread highlighting, the window-title count, and the side-panel counts work on remote messages without change.
- A local change in a synchronized discussion emits an event. A local change in a detached copy does not.

---

## 11. Application lifecycle and tray (D-16, D-33)

- When the last window closes, the app stays in the tray if at least one synchronized discussion exists. Otherwise it
  quits as today.
- The first time the app closes to the tray, it shows a one-time notice.
- Tray menu: open a discussion, sync status, "Проверить папки", exit.
- Windows notification for each new message from another member. Setting "Уведомления о новых сообщениях", default
  on.
- Setting "Запускать вместе с Windows". It is turned on after the first synchronized discussion is created or
  joined; the wizard says so (D-36).
- Notification content (D-38): author, discussion name, and the first characters of the text. Setting "Показывать
  текст в уведомлениях" turns the text off. Default and length: **[Pending Q-39]**.
- Missing registered file at start: warning in the tray menu with "Найти файл…" (D-27).
- "Exit" from the tray is a normal close. A downloaded update installs then (FR-141).
- Single instance stays. Double-clicking a `.branchchat` file while the app is in the tray opens a window.

---

## 12. Invitations and onboarding

### 12.1 Public-key bundle (D-21)

A bundle contains: `participantId`, display name, public signing key, public encryption key, fingerprint, protocol
version. It is not secret. Users exchange it through `keys/` in the shared folder, or as a file or text (for example
through WhatsApp).

### 12.2 Invitation

- An invitation is encrypted to the invitee's public encryption key and signed by the inviting member.
- It contains: the conversation ID, the minimum protocol version, the roster with public keys, and the current
  discussion (the full `DocumentContents` plus all image bytes).
- A large invitation uses the header-and-parts method of Section 9.4. The join wizard shows the progress.
- The invitee checks the signature and the fingerprint of the inviting member, creates a local `.branchchat` file
  from the invitation, and starts sync.

### 12.3 Create wizard (File > "Новое общее обсуждение…")

1. Explain what a synchronized discussion is and what the sync provider can still see.
2. Create the identity if it does not exist. Show the fingerprint. Explain that private keys stay on this computer
   and that key loss means a re-invitation.
3. Select where to save the local `.branchchat` file (outside the shared folder).
4. Explain how to create and share a folder in the sync product (for example Google Drive for Desktop), and how to
   make it available offline.
5. Select the local path of the shared folder (a normal Windows drive and path). Run a write, read, and delete test
   in a test subfolder.
6. Publish the own public-key bundle. Collect the bundles of the other people (folder, file, or pasted text).
7. Review each candidate: name and fingerprint. Accept or discard.
8. Send invitations. Show the roster and the state of each invitee: "invited", "joined".

### 12.4 Convert wizard (File > "Сделать обсуждение общим…")

Same as the create wizard, but step 3 uses the open discussion. If the file is in the shared folder, the wizard asks
the person to move it first.

### 12.5 Join wizard (File > "Присоединиться к обсуждению…")

1. Create the identity if it does not exist. Publish the public-key bundle.
2. Select the local path of the shared folder. Run the folder test.
3. Wait for the invitation. Show the progress of a large invitation. Check the inviter's fingerprint.
4. Select where to save the local `.branchchat` file (outside the shared folder).
5. Import the discussion and start sync.

---

## 13. Shared-folder layout and cleanup

```text
<shared root>/
  branchchat-sync.json            protocol version and conversation ID only (no names, no content)
  keys/<participantId>.bckey      public-key bundles
  inbox/<participantId>/          one folder per member
    <eventId>.bcmsg               encrypted event for this member
    <partId>.bcpart               encrypted part of a large message or invitation
    <eventId>.bcrcpt              encrypted receipt for this member
    <invitationId>.bcinv          encrypted invitation header for this member
  .test/<random>.tmp              folder test, deleted after the test
```

- File names use random IDs only.
- Never write plain text, private keys, local state, logs, or decrypted images into the shared folder.
- A sender writes into the inbox of each other member.
- Write a file under a temporary name in the same folder, then rename it. Ignore `.tmp` files.

Cleanup (D-19, D-34):

- The owner of an inbox deletes each processed file in it (events, parts, receipts, invitations).
- If a delete fails, the owner records the file as processed and ignores it on later scans.
- The sender deletes its own event and part files after the delivery receipt for them.
- The writer of a receipt deletes it after 7 days if it is still there.
- The sender deletes its own files that never got a receipt after 30 days.

---

## 14. Outgoing flow

1. The user makes a change. The existing domain function changes the local discussion. The file is saved as today.
2. The sync service builds the event and its parts (Section 9.4). It assigns event IDs, part IDs, and sender
   sequence numbers.
3. The crypto module signs each event once and encrypts each event and part once per recipient.
4. The sync service records each recipient copy in the local outbox.
5. The transport writes each copy with temp-file-then-rename into the recipient's inbox. `message.sent` is written
   before its parts.
6. The sync service marks each recipient copy as "written". When all copies of a message (header and parts) are
   written, the message shows one grey check.
7. On partial failure, retry only the missing copies. Never create a new event ID for a retry.
8. Retry rule (D-29): at start and every 30 minutes, write an unconfirmed copy again only if a valid event or receipt
   from that recipient arrived since the last write of the copy. No maximum number of retries. Parts use the same
   rule.

---

## 15. Incoming flow

1. A watcher event or a scan finds a file in the own inbox.
2. Wait until the file size is stable. Refuse a file larger than the limit in Settings (D-11).
3. Decrypt. Verify the signature. Check conversation ID, recipient ID, sender in roster (with an accepted key),
   event ID, and sequence. For a part: check that a known header lists it and that the SHA-256 matches.
4. If the event or part was already processed, skip step 5.
5. Apply the event (Section 9). For a message with parts, store the header or part and wait until all parts are
   present. If a dependency is missing, put the event in the pending queue and stop here.
6. Save the local file and the local sync state.
7. Write `receipt.delivered` into the sender's inbox.
8. Delete the processed file, or record it as processed (Section 13).
9. After a crash between steps 6 and 8, the next scan finds the file, sees it as processed, and completes steps 7
   and 8.

Invalid files: add a record to a local quarantine list. Do not delete another member's files. Log only safe error
codes.

---

## 16. Delivery and read state

### 16.1 Delivery (D-09)

Delivery state is local to the sender. It is stored in the local sync state, not in the `.branchchat` file.

| Mark            | Meaning                                                                                     |
|-----------------|---------------------------------------------------------------------------------------------|
| One grey check  | The header and all parts of the message are written to the shared folder for all recipients |
| Two grey checks | All recipients sent valid delivery receipts for the header and all parts                    |

The one grey check does not mean that the file reached the cloud.

### 16.2 Read (D-08)

- The existing read rules stay (FR-112).
- When the local read state grows, the app sends `readstate.added` to all members.
- The existing three-state "who has read" indicator (FR-122, FR-123) is the read mark. No green checkmark.

### 16.3 Group details

The message details show, per member: written, delivered, read.

---

## 17. Watching and scanning (D-17)

- Chokidar gives fast notice. Watch events are an optimization only.
- Do full scans: at start, when the folder becomes available again, after watcher errors, periodically, and on user
  request ("Проверить папки").
- Handle duplicates and sync-product conflict copies (for example `name (1).bcmsg`). Deduplicate by authenticated
  event ID or part ID plus recipient ID, never by file name.

---

## 18. Local sync state (D-17)

JSON files with the existing atomic write, per synchronized discussion, in the user data folder:

- Outbox: event or part ID, recipient ID, written / delivered, last write time.
- Processed events and parts: ID, sender, sender sequence. Processed files that could not be deleted. Own receipt
  files with their write time.
- Loading messages: headers and received parts (part bytes in a local folder, not in the JSON).
- Pending queue: events that wait for a dependency.
- Peer state: last sender sequence, last activity time, key history, pending key-replacement requests.
- Quarantine list and last scan time.

Global sync registry: `documentId`, local file path, shared folder path.

Never put this state in the shared folder.

---

## 19. Google Drive for Desktop (guidance only, D-18, D-19)

The application has no Drive-specific code. The wizard and the user guide explain:

- Drive for Desktop has two modes: streaming and mirroring.
  [Stream and mirror files](https://support.google.com/drive/answer/13401938),
  [Open files offline](https://support.google.com/drive/answer/16631477).
- In streaming mode, mark the shared folder "Available offline".
- Two setups are supported: a folder in a personal My Drive shared with Editor rights, and a shared drive.
- The shared folder appears as a normal Windows drive and path.
- Streamed files can be unavailable when Drive for Desktop is closed or signed out.
- The folder path and access are checked again at each start.

Test matrix: My Drive folder and shared drive; streaming with offline pinning; streaming without pinning; mirroring;
Drive paused, signed out, restarted, updated; permission removed and restored.

---

## 20. Security

- Keep the existing Electron settings (context isolation, sandbox, narrow preload, CSP, IPC validation).
- Crypto, keys, and file access stay in the main process or a utility process.
- Treat every file in the shared folder as untrusted. Validate events with zod schemas.
- Enforce the file size limit before a file is read.
- Restrict all transport paths to the configured shared root. Refuse path traversal and links.
- Never log keys, plain text, or decrypted payloads.
- Windows notifications can show the first characters of a message (D-38). Windows can keep them in the
  notification center. The user guide and the Settings text say so.
- Get a security review of the crypto code before release.

Protected: sync provider reading content; changed events and parts; forged events from a member whose key is not
compromised; duplicate messages from duplicate files; a member who replaces another member's keys without the
fingerprint check of the others.

Not protected: compromised endpoint; participant who shares plain text (including a detached copy); leaked private
key; metadata analysis; files deleted, held back, or damaged by the provider or by a person with folder access; quota
or permission denial of service; a malicious member who invites other people (D-13 accepts new members
automatically).

---

## 21. Testing plan

### Functional

- Create, convert, join, and use a synchronized discussion with 2 and with 3 participants.
- Each event type reaches all members and gives the same discussion on each computer.
- Branch, nested branch, branch close/reopen, branch title, images, read state, and "who has read" work across
  computers.
- Large message: loading bubble with progress bar, partial message with image placeholders, final message.
- Images larger than the file size limit.
- A non-synchronized discussion behaves as before (in version 2). A version 1 file is migrated on open.
- A detached copy (Explorer copy and "Отправить копию…") opens as a normal discussion and sends no events.
- Moved file: the app asks and updates the registry.
- Rejoin after key loss: re-invitation with the old ID, fingerprint checks, future messages arrive; rejection warning.
- Tray: sync continues with no window; notifications; exit from the tray; start with Windows.
- No leave, remove, edit, or delete controls exist.

### Offline and sync

- Recipient offline; one group member offline; sender offline before sync; all offline.
- Drive paused, restarted, signed out; folder unavailable; drive letter changed; permission removed and restored.
- Delayed, reordered, duplicated, and conflict-copy files; parts before their header.
- Concurrent messages in the same thread; concurrent branch status changes; a message to a branch closed by another
  member.
- A delete that fails: the file is recorded as processed.

### Reliability

- Stop the app during a write; after apply but before receipt; after receipt but before delete.
- Partial group send. Missing parts. Missed watcher events. Windows restart.
- Retry rule with and without recipient activity. Cleanup after 7 and 30 days.

### Security

- Changed ciphertext, changed signed fields, replayed events, unknown sender, discarded candidate key.
- Parts that do not match the signed SHA-256; parts that no header lists.
- Key replacement rejected by a member.
- Malformed and too large files. Hostile file names and path traversal.
- No private key or plain text in the shared folder or logs.

---

## 22. Open questions

Write your answer after **Answer:**. A recommendation is only a proposal.

**Q-39. Default and length of the text in notifications (D-38).**  
Your answer to Q-38: show the first characters of the text, with a setting.  
a) Default of "Показывать текст в уведомлениях": (i) on; (ii) off.  
b) How many characters? Recommendation: up to 100 characters of the plain text (the same plain text as for quotes),
cut at a word boundary, with "…". Images are shown as "[изображение]".  
c) A loading message: notify when the header arrives or when the message is processed? Recommendation: when it is
processed, because only then is it unread.  
Recommendation: a) (i), b) as above, c) when processed.  
**Answer:** a) (i), b) as above, c) when processed.

---

## 23. Tests before the release with sync

The results below are **assumed**. Do the tests and correct the results before the release that adds sync.

1. Test Google Drive for Desktop delete rights: in a personal My Drive folder shared with Editor rights, can account B
   delete a file that account A created? Same test in a shared drive with "Content manager" rights. (From Q-19.)  
   **Assumed result:** deletion is allowed in both setups. The fallback in D-19 ("record as processed") stays as a
   safety rule.
2. Test that a folder marked "Available offline" in streaming mode also makes new files available offline.  
   **Assumed result:** yes.
3. Test how a folder shared from another person's My Drive appears in Drive for Desktop (shortcut needed or not).  
   **Assumed result:** it appears as a normal Windows drive and path. The wizard asks only for that path.

---

## Appendix A. Cautions

- Google Drive for Desktop is a file sync client, not a messaging system. Its timing is not guaranteed.
- Never assume that a local file has reached the cloud.
- Never depend only on watcher events.
- Never change an event file after it is written.
- Never treat folder membership as authentication.
- Never put private keys, plain text, or local state in the shared folder.
- Never delete a file that another member wrote, except a processed file in the own inbox.
- Never invent a cryptographic protocol. Use the libsodium constructions as documented.

## Changes in revision 5

- Recorded answers Q-36 to Q-38 as decisions D-36 to D-38.
- Added the display of a loading message, with a progress bar (Section 9.4).
- Notifications can show the first characters of the text, with a setting (D-38).
- New question Q-39.

## Changes in revision 4

- Recorded answers Q-24 to Q-35 as decisions D-24 to D-35. Removed the answered questions.
- All files use schema version 2; version 1 files are migrated on open (D-28). No compatibility with version 1.0.
- Large messages: `message.sent` lists all parts; parts follow; loading and partial message in the UI (D-30). Event
  `image.data` replaced by `message.part`.
- Cleanup rules for receipts and unconfirmed files (D-34). Windows notifications for new messages (D-33); no
  notifications for sync problems (D-35).
- New questions Q-36 to Q-38.

## Changes in revision 3

- Recorded answers Q-01 to Q-23 as decisions D-01 to D-23.
- Added detached copies, schema version 2 and conversion, image events and chunks, key replacement, tray lifecycle,
  and the retry rule.

## Changes in revision 2

- Added the facts from the current code and the list of conflicts.
- Corrected the description of the read state and of the file format.
- Added events for all existing changes, ordering, dependency, and merge rules.
- Mapped components to the code structure. Removed the separate Google Drive adapter and local-only mode.
- Moved all open questions to one section, with options and recommendations.
